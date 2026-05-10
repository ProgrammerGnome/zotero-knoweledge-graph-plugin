const functions = require('@google-cloud/functions-framework');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const neo4j = require('neo4j-driver');
const cors = require('cors')({ origin: true });
const pino = require('pino');
const { Storage } = require('@google-cloud/storage');

// Logger inicializálása
const logger = pino({ level: 'info' });
const storage = new Storage();

functions.http('zoteroPipeline', (req, res) => {
  cors(req, res, async () => {
    logger.info({ method: req.method, path: req.path }, "Beérkező kérés");

    try {
      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      const NEO4J_URI = process.env.NEO4J_URI;
      const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
      const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;

      if (!GEMINI_API_KEY || !NEO4J_URI || !NEO4J_PASSWORD) {
          logger.error("Hiányzó környezeti változók!");
          return res.status(500).send("Hiányzó környezeti változók a felhőben!");
      }

      const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

      // ==========================================
      // BACKUP ENDPOINT: Automatikus mentés (Cloud Scheduler hívja)
      // ==========================================
      if (req.method === 'POST' && req.path === '/backup') {
        const bucketName = process.env.BACKUP_BUCKET_NAME;
        if (!bucketName) {
            logger.error("BACKUP_BUCKET_NAME nincs beállítva.");
            return res.status(500).send("Mentési konfigurációs hiba.");
        }

        const session = driver.session();
        try {
            logger.info("Biztonsági mentés lekérdezése indítva...");
            const result = await session.run(`MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m`);
            const backupData = result.records.map(rec => ({
                n: rec.get('n')?.properties,
                r: rec.get('r') ? { type: rec.get('r').type, properties: rec.get('r').properties } : null,
                m: rec.get('m')?.properties
            }));

            const filename = `backup_${new Date().toISOString().split('T')[0]}.json`;
            const file = storage.bucket(bucketName).file(filename);
            
            await file.save(JSON.stringify(backupData, null, 2), { contentType: 'application/json' });
            logger.info(`Biztonsági mentés sikeresen feltöltve: ${filename}`);
            return res.status(200).json({ success: true, file: filename });
        } finally {
            await session.close();
            await driver.close();
        }
      }

      // ==========================================
      // GET: Vizualizáció kiszolgálása a Zoterónak
      // ==========================================
      if (req.method === 'GET') {
        const session = driver.session();
        try {
          const result = await session.run(`MATCH (n:Article)-[r]->(m:Article) RETURN n, type(r) as relType, m LIMIT 200`);
          const nodesMap = new Map();
          const edges = [];

          result.records.forEach(record => {
            const n = record.get('n').properties;
            const m = record.get('m').properties;
            const relType = record.get('relType');

            // ÚJ: Origin mező továbbítása a Zotero grafikus megjelenítőjének
            if (!nodesMap.has(n.id)) nodesMap.set(n.id, { id: n.id, title: n.title, year: n.year, summary: n.summary, origin: n.origin || 'local' });
            if (!nodesMap.has(m.id)) nodesMap.set(m.id, { id: m.id, title: m.title, year: m.year, summary: m.summary, origin: m.origin || 'local' });
            edges.push({ source: n.id, target: m.id, type: relType });
          });

          return res.status(200).json({ nodes: Array.from(nodesMap.values()), edges });
        } finally {
          await session.close();
          await driver.close();
        }
      }

      // ==========================================
      // POST: Zotero adatok fogadása, AI elemzés, Neo4j mentés TRANZAKCIÓKKAL
      // ==========================================
      if (req.method === 'POST') {
        const articles = req.body.articles;
        if (!articles || articles.length === 0) return res.status(400).send("Nincsenek beküldött cikkek.");

        //const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        //const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const session = driver.session();
        const tx = session.beginTransaction(); // TRANZAKCIÓ INDÍTÁSA

        try {
          // 1. Meglévő cikkek lekérdezése (Deduplikáció) a tranzakción belül
          const existingIdsResult = await tx.run(
            `MATCH (a:Article) WHERE a.id IN $ids RETURN a.id as id, a.summary as summary`,
            { ids: articles.map(a => a.id) }
          );
          
          const existingMap = new Map();
          existingIdsResult.records.forEach(r => existingMap.set(r.get('id'), r.get('summary')));

          const articlesForRelationship = [];

          // 2. Új cikkek feldolgozása LLM-mel
          for (const art of articles) {
            let summary = "";
            if (existingMap.has(art.id)) {
              summary = existingMap.get(art.id);
            } else {
              const prompt = `Írj pontosan 2 mondatos magyar összefoglalót a következő cikkről. Cím: ${art.title}\nSzöveg (részlet): ${art.text.substring(0, 4000)}`;
              const startLlm = Date.now();
              const aiResult = await model.generateContent(prompt);
              logger.info({ durationMs: Date.now() - startLlm }, `LLM Összefoglaló generálva: ${art.id}`);
              summary = aiResult.response.text().trim();

              // ÚJ: Origin mező beállítása és a megfelelő Címke (Label) dinamikus hozzáfűzése
              let query = `
                MERGE (a:Article {id: $id}) 
                SET a.title = $title, a.year = $year, a.summary = $summary, a.origin = $origin
              `;
              
              if (art.origin === 'web') {
                  query += ` SET a:Web`;
              } else {
                  query += ` SET a:Local`;
              }

              await tx.run(query, { 
                  id: art.id, 
                  title: art.title, 
                  year: art.year, 
                  summary: summary,
                  origin: art.origin || 'local'
              });
            }

            articlesForRelationship.push({ id: art.id, title: art.title, summary: summary });
          }

          // 3. Élek generálása AI-val
          const relPrompt = `Te egy tudományos asszisztens vagy. Az alábbi JSON tömbben cikkek azonosítóit, címeit és összefoglalóit látod. A feladatod, hogy találd meg a logikai kapcsolatokat a cikkek között! Kérlek, légy proaktív: próbálj meg minden cikkhez legalább 1-2 kapcsolódási pontot találni. Még ha lazább is a kapcsolat, kösd össze őket (például használd a COMPARES típust, ha a témájuk hasonló). 
Válaszként KIZÁRÓLAG egy érvényes JSON tömböt adj vissza, markdown nélkül: [{"source": "id1", "target": "id2", "type": "KAPCSOLAT_TÍPUSA"}]. Típusok: EXTENDS, REFUTES, SUPPORTS, APPLIES, COMPARES. Cikkek: ${JSON.stringify(articlesForRelationship)}`;

            const startRelLlm = Date.now();
            const relResult = await model.generateContent(relPrompt);
            logger.info({ durationMs: Date.now() - startRelLlm }, "LLM Kapcsolatok generálva");
            
            let relText = relResult.response.text().trim();
            if (relText.startsWith('```json')) relText = relText.replace(/^```json/, '').replace(/```$/, '').trim();
            else if (relText.startsWith('```')) relText = relText.replace(/^```/, '').replace(/```$/, '').trim();

            const relationships = JSON.parse(relText);

            for (const rel of relationships) {
              if (rel.source && rel.target && rel.type) {
                await tx.run(
                  `MATCH (a:Article {id: $source}), (b:Article {id: $target}) MERGE (a)-[r:${rel.type}]->(b)`,
                  { source: String(rel.source), target: String(rel.target) }
                );
              }
            }
          }

          // HA MINDEN SIKERES, TRANZAKCIÓ JÓVÁHAGYÁSA
          await tx.commit();
          logger.info("Adatbázis tranzakció sikeresen véglegesítve (COMMIT).");
          res.status(200).json({ success: true });

        } catch (error) {
          // HIBA ESETÉN VISSZAVONÁS
          await tx.rollback();
          logger.error({ error: error.message, stack: error.stack }, "Tranzakció visszavonva (ROLLBACK) hiba miatt.");
          res.status(500).json({ success: false, error: error.message });
        } finally {
          await session.close();
          await driver.close();
        }
      }
    } catch (error) {
      logger.error({ error: error.message }, "Globális hiba a funkcióban.");
      res.status(500).json({ success: false, error: error.message });
    }
  });
});
