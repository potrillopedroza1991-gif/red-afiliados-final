// --- 1. IMPORTACIÓN DE HERRAMIENTAS ---
require('dotenv').config(); 
const express = require('express');
const path = require('path');
const session = require('express-session');

// --- 2. CONFIGURACIÓN INICIAL ---
const app = express();
const PUERTO = process.env.PORT || 3000;

// --- 3. MIDDLEWARE (PREPARACIÓN DEL SERVIDOR) ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use(session({
    secret: 'una_clave_muy_secreta_para_proteger_las_sesiones_de_invertlatam',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false, // En un sitio real con HTTPS, esto debería ser 'true'
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // La sesión dura 24 horas
    }
}));


// --- 4. RUTAS (EL DIRECTOR LLAMANDO A SUS MÚSICOS) ---
const rutasAuth = require('./rutas/auth.js');
const rutasAdmin = require('./rutas/admin.js');
const rutasDashboard = require('./rutas/dashboard.js');

app.use('/', rutasAuth);
app.use('/', rutasAdmin);
app.use('/', rutasDashboard);


// --- 5. ARRANQUE DEL SERVIDOR ---
app.listen(PUERTO, () => {
    console.log(`Servidor escuchando en http://localhost:${PUERTO}`);
});