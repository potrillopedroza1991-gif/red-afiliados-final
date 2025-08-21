const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const DB_PATH = path.join(__dirname, '..', 'usuarios.json');

/**
 * Funciones de ayuda para leer y escribir en la base de datos.
 */
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

/**
 * Función de ayuda para calcular el rango de un usuario.
 */
function calcularRango(totalReferidos) {
    if (totalReferidos >= 1000) return "CEO Máximo";
    if (totalReferidos >= 500) return "Director Ejecutivo Global";
    if (totalReferidos >= 100) return "Gerente";
    if (totalReferidos >= 30) return "Arquitecto de Redes";
    if (totalReferidos >= 10) return "Estratega";
    return "Miembro";
}

// --- LOGIN EXCLUSIVO PARA EL ADMINISTRADOR ---
router.post('/procesar-admin-login', (req, res) => {
    const { email, password } = req.body;
    if (email === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        req.session.isAdmin = true;
        return res.redirect('/admin_usuarios.html');
    } else {
        res.status(401).send('<h1>Error: Credenciales de administrador incorrectas.</h1>');
    }
});

// --- API: OBTENER LA LISTA DE TODOS LOS USUARIOS ---
router.get('/api/todos-los-usuarios', (req, res) => {
    try {
        const usuarios = leerUsuarios();
        const usuariosConDatos = usuarios.map(user => {
            const { password, preguntasSeguridad, ...usuarioSeguro } = user;
            let diasRestantes = 0;
            if (user.suscripcionActiva && user.fechaVencimientoSuscripcion) {
                const diff = new Date(user.fechaVencimientoSuscripcion) - new Date();
                diasRestantes = diff > 0 ? Math.ceil(diff / (1000 * 3600 * 24)) : 0;
            }
            const rango = calcularRango(user.conteoReferidosTotales || 0);
            return { ...usuarioSeguro, diasRestantes, rango };
        });
        res.json(usuariosConDatos);
    } catch (error) {
        res.status(500).json({ error: "Error al leer la base de datos." });
    }
});

// --- API: OBTENER DATOS DE UN SOLO USUARIO (PARA EL EXPEDIENTE) ---
router.get('/api/usuario/:email', (req, res) => {
    try {
        const { email } = req.params;
        const usuarios = leerUsuarios();
        const usuarioEncontrado = usuarios.find(user => user.email === email);
        if (usuarioEncontrado) {
            const { password, ...usuarioSeguro } = usuarioEncontrado;
            const rango = calcularRango(usuarioEncontrado.conteoReferidosTotales || 0);
            res.json({ ...usuarioSeguro, rango });
        } else {
            res.status(404).json({ message: "Usuario no encontrado" });
        }
    } catch (error) {
        res.status(500).json({ error: "Error en el servidor." });
    }
});

// --- API: OBTENER USUARIOS PENDIENTES (PARA admin_pagos.html) ---
router.get('/api/usuarios-pendientes', (req, res) => {
    try {
        const usuarios = leerUsuarios();
        const pendientes = usuarios.filter(user => user.estatusPago === 'pendiente_verificacion');
        res.json(pendientes);
    } catch (error) {
        res.status(500).json({ error: "Error al leer la base de datos." });
    }
});
// --- API: OBTENER COMISIONES PENDIENTES (PARA admin_pagos.html) ---
router.get('/api/comisiones-por-pagar', (req, res) => {
    try {
        const usuarios = leerUsuarios();
        const afiliadosConPago = usuarios.filter(user => user.tipoUsuario === 'afiliado' && user.suscripcionActiva && user.walletBTC && (user.comisionesPendientes || 0) > 0);
        const listaDePagos = afiliadosConPago.map(afiliado => ({
            email: afiliado.email,
            name: afiliado.name,
            walletBTC: afiliado.walletBTC,
            montoAPagar: afiliado.comisionesPendientes
        }));
        res.json(listaDePagos);
    } catch (error) {
        res.status(500).json({ error: "Error al preparar la lista de pagos." });
    }
});

// --- API: APROBAR A UN USUARIO (CON MOTOR DE COMISIONES Y BONOS) ---
router.post('/api/aprobar-usuario', (req, res) => {
    try {
        const { email } = req.body;
        let usuarios = leerUsuarios();
        const userIndex = usuarios.findIndex(user => user.email === email);

        if (userIndex !== -1 && usuarios[userIndex].estatusPago === 'pendiente_verificacion') {
            const usuarioAprobado = usuarios[userIndex];

            // 1. Actualizamos el estado del nuevo usuario
            if (!usuarioAprobado.historialPagos) usuarioAprobado.historialPagos = [];
            usuarioAprobado.historialPagos.push({ fecha: new Date().toISOString(), txid: usuarioAprobado.txid, monto: 50.00 });
            usuarioAprobado.estatusPago = 'aprobado';
            usuarioAprobado.suscripcionActiva = true;
            usuarioAprobado.txid = null;
            const hoy = new Date();
            usuarioAprobado.fechaAprobacionPago = hoy.toISOString();
            const fechaVencimiento = new Date();
            fechaVencimiento.setDate(hoy.getDate() + 30);
            usuarioAprobado.fechaVencimientoSuscripcion = fechaVencimiento.toISOString();

            // 2. Si fue referido, activamos el motor de la red
            if (usuarioAprobado.referidoPor) {
                const comisionesPorNivel = [12.50, 7.50, 2.50, 1.50, 1.00]; // 25%, 15%, 5%, 3%, 2% de $50
                let patrocinadorActualId = usuarioAprobado.referidoPor;
                
                // Subimos por la red 5 niveles
                for (let nivel = 0; nivel < 5 && patrocinadorActualId; nivel++) {
                    const patrocinadorIndex = usuarios.findIndex(p => p.idUnico === patrocinadorActualId);
                    if (patrocinadorIndex === -1) break;

                    const patrocinador = usuarios[patrocinadorIndex];
                    
                    // A. Actualizamos contadores
                    patrocinador.conteoReferidosTotales = (patrocinador.conteoReferidosTotales || 0) + 1;
                    if (nivel === 0) { // Solo al padre directo
                        patrocinador.conteoReferidosDirectos = (patrocinador.conteoReferidosDirectos || 0) + 1;
                        
                        // B. Verificamos si ganó un bono
                        if (patrocinador.conteoReferidosDirectos > 0 && patrocinador.conteoReferidosDirectos % 5 === 0) {
                            patrocinador.bonosDesbloqueados = (patrocinador.bonosDesbloqueados || 0) + 1;
                            console.log(`¡Bono desbloqueado para ${patrocinador.email}!`);
                        }
                    }

                    // C. Calculamos y sumamos la comisión
                    if(patrocinador.tipoUsuario === 'afiliado'){
                        if (!patrocinador.comisionesPendientes) patrocinador.comisionesPendientes = 0;
                        patrocinador.comisionesPendientes += comisionesPorNivel[nivel];
                        if (!patrocinador.historialComisiones) patrocinador.historialComisiones = [];
                        patrocinador.historialComisiones.push({
                            fecha: new Date().toISOString(),
                            monto: comisionesPorNivel[nivel],
                            nivel: nivel + 1,
                            deUsuario: usuarioAprobado.email
                        });
                    }
                    
                    patrocinadorActualId = patrocinador.referidoPor;
                }
            }

            escribirUsuarios(usuarios);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: 'Usuario no encontrado o ya no está pendiente.' });
        }
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// --- API: MARCAR COMISIONES COMO PAGADAS ---
router.post('/api/marcar-pagado', (req, res) => {
    try {
        const { email } = req.body;
        let usuarios = leerUsuarios();
        const userIndex = usuarios.findIndex(user => user.email === email);
        if (userIndex !== -1) {
            usuarios[userIndex].comisionesPendientes = 0; // Reseteamos el saldo
            escribirUsuarios(usuarios);
            res.json({ success: true, message: 'Comisión marcada como pagada.' });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// --- OTRAS APIS (Pausar, Reactivar, Eliminar) ---
router.post('/api/pausar-suscripcion', (req, res) => {
    try {
        const { email } = req.body;
        let usuarios = leerUsuarios();
        const userIndex = usuarios.findIndex(user => user.email === email);
        if (userIndex !== -1) {
            usuarios[userIndex].suscripcionActiva = false;
            escribirUsuarios(usuarios);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

router.post('/api/reactivar-suscripcion', (req, res) => {
    try {
        const { email } = req.body;
        let usuarios = leerUsuarios();
        const userIndex = usuarios.findIndex(user => user.email === email);
        if (userIndex !== -1) {
            usuarios[userIndex].suscripcionActiva = true;
            escribirUsuarios(usuarios);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

router.post('/api/eliminar-usuario', (req, res) => {
    try {
        const { email } = req.body;
        let usuarios = leerUsuarios();
        const usuariosFiltrados = usuarios.filter(user => user.email !== email);
        if (usuarios.length > usuariosFiltrados.length) {
            escribirUsuarios(usuariosFiltrados);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

module.exports = router;