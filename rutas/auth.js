const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, '..', 'usuarios.json');

/**
 * Función de ayuda para leer la base de datos de forma segura.
 */
function leerUsuarios() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            return data ? JSON.parse(data) : [];
        }
    } catch (error) {
        console.error("Error al leer usuarios.json:", error);
    }
    return [];
}

/**
 * Función de ayuda para escribir en la base de datos de forma segura.
 */
function escribirUsuarios(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error al escribir en usuarios.json:", error);
    }
}

// --- RUTA PARA REGISTRAR UN USUARIO ---
router.post('/procesar-registro', async (req, res) => {
    try {
        const usuarios = leerUsuarios();
        if (usuarios.some(user => user.email === req.body.email)) {
            return res.status(400).send('<h1>Error: El email ya está registrado.</h1><a href="/login.html">Volver</a>');
        }
        
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);
        
        const nombreBase = req.body.name.split(' ')[0].toUpperCase();
        const codigoReferidoRecibido = req.body.codigoReferido;
        let idDelReferente = null;

        if (codigoReferidoRecibido) {
            const referente = usuarios.find(user => user.codigoReferido === codigoReferidoRecibido);
            if (referente) idDelReferente = referente.idUnico;
        }
        
        const nuevoUsuario = {
            idUnico: `usr_${Date.now()}`,
            name: req.body.name,
            email: req.body.email,
            password: hashedPassword,
            fechaNacimiento: req.body.fechaNacimiento,
            rol: 'usuario',
            tipoUsuario: 'afiliado',
            suscripcionActiva: false,
            estatusPago: 'pendiente_pago',
            fechaRegistro: new Date().toISOString(),
            fechaVencimientoSuscripcion: null,
            walletBTC: null,
            referidoPor: idDelReferente,
            codigoReferido: `${nombreBase}${Math.floor(100 + Math.random() * 900)}`,
            conteoReferidosDirectos: 0,
            conteoReferidosTotales: 0,
            bonosDesbloqueados: 0,
            comisionesPendientes: 0,
            historialPagos: [],
            historialComisiones: []
        };

        usuarios.push(nuevoUsuario);
        escribirUsuarios(usuarios);
        
        res.redirect(`/pago.html?email=${encodeURIComponent(nuevoUsuario.email)}`);
    } catch (error) {
        console.error("Error crítico en el registro:", error);
        res.status(500).send("Error interno al procesar el registro.");
    }
});
// --- RUTA PARA CONFIRMAR EL PAGO ---
router.post('/confirmar-pago', (req, res) => {
    try {
        const { email, txid } = req.body;
        if (!txid || txid.trim() === '') {
            return res.status(400).send('<h1>Error: El ID de transacción no puede estar vacío.</h1>');
        }
        
        const usuarios = leerUsuarios();
        // Filtro Anti-Reciclaje de IDs
        for (const usuario of usuarios) {
            if (usuario.txid === txid || (usuario.historialPagos && usuario.historialPagos.some(pago => pago.txid === txid))) {
                return res.status(400).send('<h1>Error: Este ID de transacción ya ha sido registrado.</h1>');
            }
        }
        const userIndex = usuarios.findIndex(user => user.email === email);
        if (userIndex !== -1) {
            usuarios[userIndex].estatusPago = 'pendiente_verificacion';
            usuarios[userIndex].txid = txid; // ID de transacción temporal para el admin
            usuarios[userIndex].fechaReportePago = new Date().toISOString();
            escribirUsuarios(usuarios);
            res.send('<h1>¡Gracias! Hemos recibido tu confirmación.</h1><p>Tu cuenta será activada por un administrador.</p>');
        } else {
            res.status(400).send('<h1>Error: No se pudo encontrar tu usuario.</h1>');
        }
    } catch (error) {
        console.error("Error crítico al confirmar pago:", error);
        res.status(500).send("Error en el servidor al confirmar pago.");
    }
});

// --- RUTA PARA LOGIN DE USUARIOS (VERSIÓN SEGURA) ---
router.post('/procesar-login', async (req, res) => { // <-- AHORA ES ASÍNCRONA
    try {
        const { email, password } = req.body;
        let usuarios = leerUsuarios();
        const usuarioEncontrado = usuarios.find(user => user.email === email);

        // Si no se encuentra el usuario, o si no tiene contraseña (puede pasar con datos viejos)
        if (!usuarioEncontrado || !usuarioEncontrado.password) {
            return res.status(401).send('<h1>Error: Email o contraseña incorrectos.</h1>');
        }
        
        // --- ZONA DE SEGURIDAD ---
        const contrasenaCoincide = await bcrypt.compare(password, usuarioEncontrado.password);
        // --- FIN DE ZONA DE SEGURIDAD ---

        if (contrasenaCoincide) {
            const userIndex = usuarios.findIndex(user => user.email === email); // Necesitamos el index para actualizar
            const esAprobado = ['aprobado', 'vencido', 'pausado'].includes(usuarioEncontrado.estatusPago);
            if (esAprobado) {
                if (!usuarioEncontrado.suscripcionActiva) {
                    return res.redirect(`/pago.html?email=${encodeURIComponent(email)}&mensaje=pausado`);
                }
                const hoy = new Date();
                const fechaVencimiento = new Date(usuarioEncontrado.fechaVencimientoSuscripcion);
                if (hoy > fechaVencimiento) {
                    usuarios[userIndex].suscripcionActiva = false;
                    usuarios[userIndex].estatusPago = 'vencido';
                    escribirUsuarios(usuarios);
                    return res.redirect(`/pago.html?email=${encodeURIComponent(email)}&mensaje=vencido`);
                }
                req.session.usuarioEmail = usuarioEncontrado.email;
                return res.redirect('/dashboard.html');
            } else {
                return res.redirect(`/pago.html?email=${encodeURIComponent(email)}`);
            }
        } else {
            res.status(401).send('<h1>Error: Email o contraseña incorrectos.</h1>');
        }
    } catch (error) {
        console.error("Error crítico durante el login:", error);
        res.status(500).send("Error en el servidor durante el login.");
    }
});

module.exports = router;