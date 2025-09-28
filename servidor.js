require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');

const app = express();
const PUERTO = process.env.PORT || 3000;

// Middleware para procesar JSON y datos de formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware para permitir que el frontend se comunique con el backend
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));

// Configuración de la sesión
app.use(session({
    secret: 'una_clave_muy_secreta_para_proteger_las_sesiones_de_invertlatam',
    resave: false,
    saveUninitialized: true, // Importante: guarda la sesión incluso si está vacía
    cookie: {
        secure: false, // Poner en 'true' si usas HTTPS
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // La sesión dura 1 día
    }
}));

// Servir archivos estáticos (HTML, CSS, etc.)
app.use(express.static(path.join(__dirname)));

// Cargar las rutas
const rutasAuth = require('./rutas/auth.js');
const rutasAdmin = require('./rutas/admin.js');
const rutasDashboard = require('./rutas/dashboard.js');

// Usar las rutas
app.use('/', rutasAuth);
app.use('/', rutasAdmin);
app.use('/', rutasDashboard);

// Iniciar el servidor
app.listen(PUERTO, () => {
    console.log(`Servidor escuchando en el puerto ${PUERTO}`);
});