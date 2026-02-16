const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Caminhos para os certificados SSL
const sslKeyPath = path.join(__dirname, '..', 'ssl', 'private-key.pem');
const sslCertPath = path.join(__dirname, '..', 'ssl', 'certificate.pem');

const app = express();
const PORT = 3000;
const HTTPS_PORT = 3443;
const HTTP_PORT = 3000;

app.use(cors());
// Aumenta o limite de JSON para garantir que metadados passam
app.use(express.json({ limit: '1mb' }));

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

// --- ROTA DE UPLOAD ROBUSTA ---
// Aceita raw body até 100MB (embora usemos 5MB no frontend)
app.post('/api/upload_chunk', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
    try {
        const { filename, chunk_number, total_chunks, original_name, key, permission } = req.query;
        
        // ✅ Validação melhorada
        if (!filename || !chunk_number || !total_chunks || !original_name || !req.body) {
            return res.status(400).json({ error: 'Dados inválidos ou incompletos' });
        }

        // Resto do código...
    } catch (error) {
        console.error("Erro no upload:", error);
        res.status(500).json({ error: 'Falha no servidor ao gravar pedaço.' });
    }
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
if(protocol === "https") {
    const credentials = {
        key: fs.readFileSync(path.join(__dirname, 'certs', 'privatekey.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'certs', 'certificate.pem'))
    };
    https.createServer(credentials, app).listen(HTTPS_PORT, () => {
        console.log(`✅ Servidor HTTPS a correr em https://localhost:${HTTPS_PORT}`);
    });
} else {
    // Se não houver HTTPS, inicia HTTP
    app.listen(HTTP_PORT, () => {
        console.log(`✅ Servidor HTTP a correr em http://localhost:${HTTP_PORT}`);
    });
}