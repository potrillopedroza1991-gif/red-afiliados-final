const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const DB_PATH = path.join(__dirname, '..', 'usuarios.json');
const CURSOS_DB_PATH = path.join(__dirname, '..', 'cursos.json');
const HERRAMIENTAS_DB_PATH = path.join(__dirname, '..', 'herramientas.json');

// --- FUNCIONES DE AYUDA ---
function leerUsuarios() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            return data ? JSON.parse(data) : [];
        }
    } catch (error) { console.error("Error al leer usuarios.json:", error); }
    return [];
}
function escribirUsuarios(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (error) { console.error("Error al escribir en usuarios.json:", error); }
}
function leerArchivoJSON(ruta) {
    try {
        if (fs.existsSync(ruta)) {
            const data = fs.readFileSync(ruta, 'utf8');
            return data ? JSON.parse(data) : [];
        }
    } catch (error) { console.error(`Error al leer ${ruta}:`, error); }
    return [];
}
function calcularRango(totalReferidos) {
    if (totalReferidos >= 1000) return "CEO Máximo";
    if (totalReferidos >= 500) return "Director Ejecutivo Global";
    if (totalReferidos >= 100) return "Gerente";
    if (totalReferidos >= 30) return "Arquitecto de Redes";
    if (totalReferidos >= 10) return "Estratega";
    return "Miembro";
}

// --- API: OBTENER LOS DATOS PARA EL DASHBOARD DEL USUARIO LOGUEADO ---
router.get('/api/dashboard-data', (req, res) => {
    if (!req.session || !req.session.usuarioEmail) {
        return res.status(401).json({ error: 'No autorizado.' });
    }
    try {
        const email = req.session.usuarioEmail;
        const usuarios = leerUsuarios();
        const usuarioActual = usuarios.find(user => user.email === email);
        if (!usuarioActual) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        let diasRestantes = 0;
        if (usuarioActual.suscripcionActiva && usuarioActual.fechaVencimientoSuscripcion) {
            const diff = new Date(usuarioActual.fechaVencimientoSuscripcion) - new Date();
            diasRestantes = diff > 0 ? Math.ceil(diff / (1000 * 3600 * 24)) : 0;
        }
        const rango = calcularRango(usuarioActual.conteoReferidosTotales || 0);
        const dashboardData = {
            name: usuarioActual.name,
            rango: rango,
            suscripcionActiva: usuarioActual.suscripcionActiva,
            diasRestantes: diasRestantes,
            gananciasMes: usuarioActual.comisionesPendientes || 0,
            referidosDirectos: usuarioActual.conteoReferidosDirectos,
            totalEnRed: usuarioActual.conteoReferidosTotales,
            codigoReferido: usuarioActual.codigoReferido,
            walletBTC: usuarioActual.walletBTC,
            historialComisiones: usuarioActual.historialComisiones || []
        };
        res.json(dashboardData);
    } catch (error) {
        res.status(500).json({ error: "Error al leer la base de datos." });
    }
});
// API: OBTENER LA LISTA DE REFERIDOS
router.get('/api/mi-red', (req, res) => {
    if (!req.session || !req.session.usuarioEmail) {
        return res.status(401).json({ error: 'No autorizado.' });
    }

    try {
        const email = req.session.usuarioEmail;
        const usuarios = leerUsuarios();
        const usuarioActual = usuarios.find(user => user.email === email);

        if (!usuarioActual) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        const comisionesPorNivel = [25, 15, 5, 3, 2]; // Porcentajes
        let listaDeReferidos = [];

        // Función recursiva para encontrar y aplanar la red de referidos
        function encontrarReferidos(idPadre, nivelActual, nivelMaximo) {
            if (nivelActual > nivelMaximo) return;
            
            const referidosEnEsteNivel = usuarios.filter(user => user.referidoPor === idPadre);

            referidosEnEsteNivel.forEach(referido => {
                let diasRestantes = 0;
                if (referido.suscripcionActiva && referido.fechaVencimientoSuscripcion) {
                    const diff = new Date(referido.fechaVencimientoSuscripcion) - new Date();
                    diasRestantes = diff > 0 ? Math.ceil(diff / (1000 * 3600 * 24)) : 0;
                }

                listaDeReferidos.push({
                    nombre: referido.name,
                    nivel: nivelActual,
                    estado: referido.suscripcionActiva ? 'Activo' : 'Inactivo',
                    diasRestantes: diasRestantes,
                    gananciaPorcentaje: comisionesPorNivel[nivelActual - 1]
                });
                
                // Llamada recursiva para buscar en el siguiente nivel
                encontrarReferidos(referido.idUnico, nivelActual + 1, nivelMaximo);
            });
        }

        // Iniciamos la búsqueda desde el usuario actual (nivel 1)
        encontrarReferidos(usuarioActual.idUnico, 1, 5);
        res.json(listaDeReferidos);

    } catch (error) {
        console.error("Error en /api/mi-red:", error);
        res.status(500).json({ error: "Error al construir la lista de referidos." });
    }
});

// API PARA OBTENER LOS CURSOS
router.get('/api/cursos', (req, res) => {
    try {
        const catalogoDeCursos = leerArchivoJSON(CURSOS_DB_PATH);
        res.json(catalogoDeCursos);
    } catch (error) {
        res.status(500).json({ error: "No se pudo cargar el catálogo de cursos." });
    }
});

// API PARA OBTENER LAS HERRAMIENTAS
router.get('/api/herramientas', (req, res) => {
    try {
        const catalogoDeHerramientas = leerArchivoJSON(HERRAMIENTAS_DB_PATH);
        res.json(catalogoDeHerramientas);
    } catch (error) {
        res.status(500).json({ error: "No se pudo cargar el catálogo de herramientas." });
    }
});

// API: GUARDAR LA WALLET DEL USUARIO
router.post('/api/guardar-wallet', (req, res) => {
    if (!req.session || !req.session.usuarioEmail) {
        return res.status(401).json({ error: 'No autorizado.' });
    }
    try {
        const email = req.session.usuarioEmail;
        let usuarios = leerUsuarios();
        const userIndex = usuarios.findIndex(user => user.email === email);
        if (userIndex !== -1) {
            usuarios[userIndex].walletBTC = req.body.walletBTC;
            escribirUsuarios(usuarios);
            res.json({ success: true, message: '¡Dirección de pago guardada con éxito!' });
        } else {
            res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        }
    } catch (error) {
        console.error("Error en /api/guardar-wallet:", error);
        res.status(500).json({ success: false, error: "Error en el servidor." });
    }
});

module.exports = router;