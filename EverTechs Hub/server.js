// server.js
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

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

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor Ever Techs a correr em http://localhost:${PORT}`);
    console.log(`📅 ${new Date().toLocaleString('pt-PT')}`);
});
