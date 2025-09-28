const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const PERFILES_DB_PATH = path.join(__dirname, '..', 'perfiles.json');
const CURSOS_DB_PATH = path.join(__dirname, '..', 'cursos.json');
const HERRAMIENTAS_DB_PATH = path.join(__dirname, '..', 'herramientas.json');
const USUARIOS_DB_PATH = path.join(__dirname, '..', 'usuarios.json');

function leerPerfiles() {
    try {
        if (fs.existsSync(PERFILES_DB_PATH)) return JSON.parse(fs.readFileSync(PERFILES_DB_PATH, 'utf8'));
    } catch (e) { console.error("Error al leer perfiles.json:", e); return []; }
}
function leerUsuarios() {
    try {
        if (fs.existsSync(USUARIOS_DB_PATH)) return JSON.parse(fs.readFileSync(USUARIOS_DB_PATH, 'utf8'));
    } catch (e) { console.error("Error al leer usuarios.json:", e); }
    return [];
}
function escribirPerfiles(data) {
    try {
        fs.writeFileSync(PERFILES_DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) { console.error("Error al escribir en perfiles.json:", e); }
}

function verificarAutenticacion(req, res, next) {
    if (req.session && req.session.idUnico) {
        return next();
    }
    res.status(401).json({ error: 'No autorizado' });
}

function calcularRango(totalReferidos) {
    if (totalReferidos >= 2000) return "CEO Máximo";
    if (totalReferidos >= 1000) return "CEO";
    if (totalReferidos >= 500) return "Presidente";
    if (totalReferidos >= 250) return "Director";
    if (totalReferidos >= 100) return "Gerente";
    if (totalReferidos >= 50) return "Supervisor";
    if (totalReferidos >= 30) return "Coordinador";
    if (totalReferidos >= 15) return "Asistente";
    if (totalReferidos >= 1) return "Líder";
    return "Usuario";
}

router.get('/api/dashboard-data', verificarAutenticacion, (req, res) => {
    const perfiles = leerPerfiles();
    const perfilUsuario = perfiles.find(p => p.idUnico === req.session.idUnico);
    if (!perfilUsuario) return res.status(404).json({ error: 'Perfil no encontrado' });

    let diasRestantes = 0;
    if (perfilUsuario.suscripcionActiva && perfilUsuario.fechaVencimientoSuscripcion) {
        const hoy = new Date();
        const fechaVencimiento = new Date(perfilUsuario.fechaVencimientoSuscripcion);
        diasRestantes = Math.max(0, Math.ceil((fechaVencimiento - hoy) / (1000 * 60 * 60 * 24)));
    }
    
    const rangoDelUsuario = calcularRango(perfilUsuario.conteoReferidosTotales || 0);

    const datosParaFrontend = {
        name: perfilUsuario.name,
        rango: rangoDelUsuario,
        suscripcionActiva: perfilUsuario.suscripcionActiva,
        diasRestantes: diasRestantes,
        comisionesPendientes: perfilUsuario.comisionesPendientes || 0,
        conteoReferidosDirectos: perfilUsuario.conteoReferidosDirectos || 0,
        conteoReferidosTotales: perfilUsuario.conteoReferidosTotales || 0,
        codigoReferido: perfilUsuario.codigoReferido,
        walletBTC: perfilUsuario.walletBTC || '',
        historialPagos: perfilUsuario.historialPagos || [],
        comisionesPagadas: perfilUsuario.comisionesPagadas || []
    };
    res.json(datosParaFrontend);
});

router.post('/api/guardar-wallet', verificarAutenticacion, (req, res) => {
    const { walletBTC } = req.body;
    let perfiles = leerPerfiles();
    const perfilIndex = perfiles.findIndex(p => p.idUnico === req.session.idUnico);
    if (perfilIndex !== -1) {
        perfiles[perfilIndex].walletBTC = walletBTC;
        escribirPerfiles(perfiles);
        res.json({ message: '¡Dirección de wallet guardada con éxito!' });
    } else {
        res.status(404).json({ message: 'Error: Usuario no encontrado.' });
    }
});

router.get('/api/mi-red', verificarAutenticacion, (req, res) => {
    try {
        const perfiles = leerPerfiles();
        const usuarios = leerUsuarios();
        const emailMap = new Map(usuarios.map(u => [u.idUnico, u.email]));
        const usuarioActual = perfiles.find(p => p.idUnico === req.session.idUnico);
        if (!usuarioActual) return res.status(404).json([]);

        let redAplanada = [];
        function encontrarReferidos(idPadre, nivel) {
            if (nivel > 5) return;
            const referidosDirectos = perfiles.filter(p => p.referidoPor === idPadre);
            referidosDirectos.forEach(ref => {
                redAplanada.push({
                    nombre: ref.name,
                    email: emailMap.get(ref.idUnico) || 'N/A',
                    fechaRegistro: ref.fechaRegistro,
                    nivel: nivel,
                    estado: ref.suscripcionActiva ? 'Activo' : 'Inactivo'
                });
                encontrarReferidos(ref.idUnico, nivel + 1);
            });
        }
        encontrarReferidos(usuarioActual.idUnico, 1);
        res.json(redAplanada);
    } catch(error) {
        console.error("Error en /api/mi-red:", error);
        res.status(500).json([]);
    }
});

router.get('/api/cursos', verificarAutenticacion, (req, res) => {
    const cursos = JSON.parse(fs.readFileSync(CURSOS_DB_PATH, 'utf8'));
    res.json(cursos);
});

router.get('/api/herramientas', verificarAutenticacion, (req, res) => {
    const herramientas = JSON.parse(fs.readFileSync(HERRAMIENTAS_DB_PATH, 'utf8'));
    res.json(herramientas);
});

module.exports = router;