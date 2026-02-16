const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Caminhos para os certificados SSL (Unificados)
const sslKeyPath = path.join(__dirname, '..', 'ssl', 'private-key.pem');
const sslCertPath = path.join(__dirname, '..', 'ssl', 'certificate.pem');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const HTTP_PORT = process.env.HTTP_PORT || 3000;

// Configuração CORS mais segura
const corsOptions = {
    origin: '*', // Idealmente, restringir para domínios específicos em produção
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-owner-key']
};
app.use(cors(corsOptions));

// Aumenta o limite de JSON para garantir que metadados passam
app.use(express.json({ limit: '1mb' }));

// Middleware de tratamento de erros global
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// Configuração para servir ficheiros (Streaming de Vídeo)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res) => {
        res.set("Accept-Ranges", "bytes");
        res.set("Access-Control-Allow-Origin", "*");
    }
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// "Base de dados" simples
let files = [];
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// --- ROTA DE UPLOAD ROBUSTA ---\r
// Aceita raw body até 100MB (embora usemos 5MB no frontend)\r
app.post('/api/upload_chunk', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {\r
    try {\r
        const { filename, chunk_number, total_chunks, original_name, key, permission } = req.query;\r
        \r
        // ✅ Validação melhorada\r
        if (!filename || !chunk_number || !total_chunks || !original_name || !req.body) {\r
            return res.status(400).json({ error: 'Dados inválidos ou incompletos' });\r
        }\r
\r
        const chunkIndex = parseInt(chunk_number);\r
        const total = parseInt(total_chunks);\r
        const filePath = path.join(UPLOAD_DIR, filename);\r
        const tempPath = `${filePath}.part${chunkIndex}`;\r
\r
        // Gravar o pedaço temporariamente\r
        fs.writeFileSync(tempPath, req.body);\r
\r
        // Verificar se todos os pedaços chegaram para reconstruir\r
        // (Lógica simplificada: num cenário real, usaríamos um registo de estado)\r
        // Aqui assumimos que o cliente envia sequencialmente ou que verificamos o final\r
        \r
        // Se for o último chunk, tentar reconstruir (isto é uma simplificação)\r
        // Num sistema robusto, verificaríamos se todos os ficheiros .part existem\r
        if (chunkIndex === total - 1) {\r
             const finalFile = fs.createWriteStream(filePath);\r
             for (let i = 0; i < total; i++) {\r
                 const part = `${filePath}.part${i}`;\r
                 if (fs.existsSync(part)) {\r
                     const data = fs.readFileSync(part);\r
                     finalFile.write(data);\r
                     fs.unlinkSync(part); // Limpar chunks\r
                 }\r
             }\r
             finalFile.end();\r
             \r
             // Adicionar à "base de dados"\r
             files.push({\r
                 id: Date.now().toString(),\r
                 filename: filename,\r
                 originalName: original_name,\r
                 ownerKey: key,\r
                 size: fs.statSync(filePath).size,\r
                 mimeType: getMimeType(filename),\r
                 uploadDate: new Date()\r
             });\r
             \r
             return res.json({ success: true, message: 'Upload completo' });\r
        }\r
\r
        res.json({ success: true, message: `Chunk ${chunkIndex} recebido` });\r
\r
    } catch (error) {\r
        console.error("Erro no upload:", error);\r
        res.status(500).json({ error: 'Falha no servidor ao gravar pedaço.' });\r
    }\r
});

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video/mp4'; // Força video/mp4 para tentar compatibilidade
    if (['.jpg', '.png', '.jpeg', '.gif', '.webp'].includes(ext)) return 'image/jpeg';
    return 'application/octet-stream';
}

// Rotas da API
app.get('/api/files', (req, res) => res.json(files.filter(f => f.ownerKey === req.query.key)));
app.get('/api/files/:id', (req, res) => {
    const f = files.find(x => x.id === req.params.id);
    if (!f) return res.status(404).json({});
    const { ownerKey, ...public } = f;
    res.json(public);
});
app.delete('/api/files/:id', (req, res) => {
    const key = req.query.key || req.headers['x-owner-key']; // Aceita query ou header
    const idx = files.findIndex(f => f.id === req.params.id);
    if(idx === -1) return res.status(404).json({ error: 'Ficheiro não encontrado' });
    if(files[idx].ownerKey !== key) return res.status(403).json({ error: 'Sem permissão' });
    
    try { 
        fs.unlinkSync(path.join(UPLOAD_DIR, files[idx].filename)); 
    } catch(e) {
        console.error('Erro ao apagar ficheiro:', e);
    }
    
    files.splice(idx, 1);
    res.json({success: true});
});

// Verificar se os certificados SSL existem
if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
    const credentials = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath)
    };
    https.createServer(credentials, app).listen(HTTPS_PORT, () => {
        console.log(`✅ Servidor HTTPS a correr em https://localhost:${HTTPS_PORT}`);
    });
    
    // Redirecionamento HTTP -> HTTPS opcional
    http.createServer((req, res) => {
        res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
        res.end();
    }).listen(HTTP_PORT);
    
} else {
    // Se não houver HTTPS, inicia HTTP
    app.listen(HTTP_PORT, () => {
        console.log(`✅ Servidor HTTP a correr em http://localhost:${HTTP_PORT}`);
        console.warn('⚠️ Certificados SSL não encontrados. A rodar em modo não seguro.');
    });
}
