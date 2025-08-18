// --- 1. IMPORTACIÓN DE HERRAMIENTAS ---
// Carga las variables de entorno (como las credenciales de admin)
require('dotenv').config();
// El framework principal para construir el servidor
const express = require('express');
// Herramienta de Node.js para manejar rutas de archivos
const path = require('path');
// Herramienta para "recordar" a los usuarios que inician sesión (sesiones)
const session = require('express-session');

// --- 2. CONFIGURACIÓN INICIAL ---
const app = express();
// ▼▼▼ ¡ESTE ES EL CAMBIO CLAVE! ▼▼▼
// El servidor usará el puerto que le asigne Render. Si no existe, usará el 3000 (para pruebas locales).
const PUERTO = process.env.PORT || 3000;

// --- 3. MIDDLEWARE (PREPARACIÓN DEL SERVIDOR) ---
// Permite al servidor entender datos en formato JSON
app.use(express.json());
// Permite al servidor entender los datos enviados desde formularios HTML
app.use(express.urlencoded({ extended: true }));
// Hace que todos los archivos en la carpeta principal (HTML, CSS, imágenes) sean accesibles públicamente
app.use(express.static(path.join(__dirname)));
// Activa el sistema de sesiones para recordar a los usuarios
app.use(session({
    secret: 'una_clave_muy_secreta_para_proteger_las_sesiones_de_invertlatam',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false, // En un sitio real con HTTPS, esto sería 'true'
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // La sesión dura 24 horas
    }
}));


// --- 4. RUTAS (EL DIRECTOR LLAMANDO A SUS MÚSICOS) ---
// Conecta los cables a los archivos de lógica que están en la carpeta "rutas"
const rutasAuth = require('./rutas/auth.js');
const rutasAdmin = require('./rutas/admin.js');
const rutasDashboard = require('./rutas/dashboard.js');

app.use('/', rutasAuth);       // Conecta la lógica de registro y login de usuarios
app.use('/', rutasAdmin);      // Conecta la lógica del panel de administrador
app.use('/', rutasDashboard);  // Conecta la lógica del panel de usuario


// --- 5. ARRANQUE DEL SERVIDOR ---
// La última pieza, que enciende el motor
app.listen(PUERTO, () => {
    // El mensaje ahora mostrará el puerto que esté en uso
    console.log(`Servidor escuchando en el puerto ${PUERTO}`);
});