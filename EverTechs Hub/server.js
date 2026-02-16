const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();

// Porta padrão (80 para HTTP, 443 para HTTPS)
const HTTP_PORT = process.env.HTTP_PORT || 3101;
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;

// Middleware para servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware de erro 404
app.use((req, res) => {
    res.status(404).send('<h1>404 - Página não encontrada</h1>');
});

// Verificar se os certificados SSL existem
const sslKeyPath = path.join(__dirname, '..', 'ssl', 'private-key.pem');
const sslCertPath = path.join(__dirname, '..', 'ssl', 'certificate.pem');

if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
    // Configuração SSL
    const sslOptions = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath)
    };

    // Servidor HTTPS
    https.createServer(sslOptions, app).listen(HTTPS_PORT, () => {
        console.log(`✅ Servidor HTTPS Ever Techs a correr em https://localhost:${HTTPS_PORT}`);
        console.log(`⏰ ${new Date().toLocaleString('pt-PT')}`);
    });

    // Servidor HTTP (redireciona para HTTPS)
    http.createServer((req, res) => {
        res.writeHead(301, { 
            'Location': `https://${req.headers.host.replace(`:${HTTP_PORT}`, `:${HTTPS_PORT}`)}${req.url}` 
        });
        res.end();
    }).listen(HTTP_PORT, () => {
        console.log(`🔄 Redirecionamento HTTP → HTTPS ativo na porta ${HTTP_PORT}`);
    });

} else {
    // Fallback para HTTP se não existirem certificados
    console.warn('⚠️  Certificados SSL não encontrados. A iniciar em modo HTTP...');
    const PORT = process.env.PORT || 3001;
    
    app.listen(PORT, () => {
        console.log(`🌐 Servidor Ever Techs a correr em http://localhost:${PORT}`);
        console.log(`⏰ ${new Date().toLocaleString('pt-PT')}`);
    });
}
