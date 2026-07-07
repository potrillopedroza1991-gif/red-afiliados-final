const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const USUARIOS_DB_PATH = path.join(__dirname, '..', 'usuarios.json');
const PERFILES_DB_PATH = path.join(__dirname, '..', 'perfiles.json');

// --- Funciones de Ayuda ---
function leerUsuarios() {
    try {
        if (fs.existsSync(USUARIOS_DB_PATH)) return JSON.parse(fs.readFileSync(USUARIOS_DB_PATH, 'utf8'));
    } catch (e) { console.error("Error al leer usuarios.json:", e); }
    return [];
}
function escribirUsuarios(data) {
    try {
        fs.writeFileSync(USUARIOS_DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) { console.error("Error al escribir en usuarios.json:", e); }
}
function leerPerfiles() {
    try {
        if (fs.existsSync(PERFILES_DB_PATH)) return JSON.parse(fs.readFileSync(PERFILES_DB_PATH, 'utf8'));
    } catch (e) { console.error("Error al leer perfiles.json:", e); }
    return [];
}
function escribirPerfiles(data) {
    try {
        fs.writeFileSync(PERFILES_DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) { console.error("Error al escribir en perfiles.json:", e); }
}

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

// --- API: OBTENER LA LISTA DE TODOS LOS USUARIOS COMBINADOS ---
router.get('/api/todos-los-usuarios', (req, res) => {
    try {
        const usuarios = leerUsuarios();
        const perfiles = leerPerfiles();

        const listaCombinada = perfiles.map(perfil => {
            const cuentaAuth = usuarios.find(u => u.idUnico === perfil.idUnico);
            
            let diasRestantes = 0;
            if (perfil.suscripcionActiva && perfil.fechaVencimientoSuscripcion) {
                const diff = new Date(perfil.fechaVencimientoSuscripcion) - new Date();
                diasRestantes = diff > 0 ? Math.ceil(diff / (1000 * 3600 * 24)) : 0;
            }

            return {
                ...perfil,
                email: cuentaAuth ? cuentaAuth.email : 'Sin Email (Verificar)',
                diasRestantes: diasRestantes,
                rango: calcularRango(perfil.conteoReferidosTotales || 0)
            };
        });

        res.json(listaCombinada);
    } catch (error) {
        console.error("Error al estructurar lista de usuarios:", error);
        res.status(500).json({ error: "Error al leer la base de datos." });
    }
});
// --- API: OBTENER DATOS DE UN SOLO USUARIO (PARA EL EXPEDIENTE) ---
router.get('/api/usuario/:email', (req, res) => {
    try {
        const { email } = req.params;
        const usuarios = leerUsuarios();
        const perfiles = leerPerfiles();

        const cuentaAuth = usuarios.find(user => user.email === email);
        if (!cuentaAuth) {
            return res.status(404).json({ message: "Usuario no encontrado en sistema de autenticación." });
        }

        const perfilEncontrado = perfiles.find(p => p.idUnico === cuentaAuth.idUnico);
        if (perfilEncontrado) {
            const rango = calcularRango(perfilEncontrado.conteoReferidosTotales || 0);
            res.json({ ...perfilEncontrado, email: cuentaAuth.email, rango });
        } else {
            res.status(404).json({ message: "Perfil de usuario no encontrado." });
        }
    } catch (error) {
        console.error("Error al buscar expediente de usuario:", error);
        res.status(500).json({ error: "Error en el servidor." });
    }
});

// --- API: OBTENER USUARIOS PENDIENTES (PARA admin_pagos.html) ---
router.get('/api/usuarios-pendientes', (req, res) => {
    try {
        const usuarios = leerUsuarios();
        const perfiles = leerPerfiles();

        const pendientes = perfiles
            .filter(p => p.estatusPago === 'pendiente_verificacion')
            .map(perfil => {
                const cuentaAuth = usuarios.find(u => u.idUnico === perfil.idUnico);
                return {
                    ...perfil,
                    email: cuentaAuth ? cuentaAuth.email : 'Sin Email'
                };
            });

        res.json(pendientes);
    } catch (error) {
        res.status(500).json({ error: "Error al leer la base de datos." });
    }
});

// --- API: OBTENER COMISIONES PENDIENTES (PARA admin_pagos.html) ---
router.get('/api/comisiones-por-pagar', (req, res) => {
    try {
        const usuarios = leerUsuarios();
        const perfiles = leerPerfiles();

        const afiliadosConPago = perfiles.filter(p => p.tipoUsuario === 'afiliado' && p.suscripcionActiva && p.walletBTC && (p.comisionesPendientes || 0) > 0);
        
        const listaDePagos = afiliadosConPago.map(perfil => {
            const cuentaAuth = usuarios.find(u => u.idUnico === perfil.idUnico);
            return {
                email: cuentaAuth ? cuentaAuth.email : 'Sin Email',
                name: perfil.name,
                walletBTC: perfil.walletBTC,
                montoAPagar: perfil.comisionesPendientes
            };
        });
        
        res.json(listaDePagos);
    } catch (error) {
        res.status(500).json({ error: "Error al preparar la lista de pagos." });
    }
});

// --- API: APROBAR A UN USUARIO (CON MOTOR DE COMISIONES Y BONOS CORREGIDO) ---
router.post('/api/aprobar-usuario', (req, res) => {
    try {
        const { email } = req.body;
        const usuarios = leerUsuarios();
        let perfiles = leerPerfiles();

        const cuentaAuth = usuarios.find(user => user.email === email);
        if (!cuentaAuth) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado en autenticación.' });
        }

        const perfilIndex = perfiles.findIndex(p => p.idUnico === cuentaAuth.idUnico);

        if (perfilIndex !== -1 && perfiles[perfilIndex].estatusPago === 'pendiente_verificacion') {
            const perfilAprobado = perfiles[perfilIndex];

            // 1. Actualizamos el estado del perfil
            if (!perfilAprobado.historialPagos) perfilAprobado.historialPagos = [];
            perfilAprobado.historialPagos.push({ fecha: new Date().toISOString(), txid: perfilAprobado.txid, monto: 50.00 });
            perfilAprobado.estatusPago = 'aprobado';
            perfilAprobado.suscripcionActiva = true;
            perfilAprobado.txid = null;
            
            const hoy = new Date();
            perfilAprobado.fechaAprobacionPago = hoy.toISOString();
            const fechaVencimiento = new Date();
            fechaVencimiento.setDate(hoy.getDate() + 30);
            perfilAprobado.fechaVencimientoSuscripcion = fechaVencimiento.toISOString();

            // 2. Si fue referido, activamos el motor multinivel subiendo por los perfiles
            if (perfilAprobado.referidoPor) {
                const comisionesPorNivel = [12.50, 7.50, 2.50, 1.50, 1.00]; 
                let patrocinadorActualId = perfilAprobado.referidoPor;
                
                for (let nivel = 0; nivel < 5 && patrocinadorActualId; nivel++) {
                    const patrocinadorIndex = perfiles.findIndex(p => p.idUnico === patrocinadorActualId);
                    if (patrocinadorIndex === -1) break;

                    const patrocinador = perfiles[patrocinadorIndex];
                    
                    // A. Actualizamos contadores globales de red
                    patrocinador.conteoReferidosTotales = (patrocinador.conteoReferidosTotales || 0) + 1;
                    if (nivel === 0) { 
                        patrocinador.conteoReferidosDirectos = (patrocinador.conteoReferidosDirectos || 0) + 1;
                        
                        // B. Verificamos si ganó un bono por cada 5 directos
                        if (patrocinador.conteoReferidosDirectos > 0 && patrocinador.conteoReferidosDirectos % 5 === 0) {
                            patrocinador.bonosDesbloqueados = (patrocinador.bonosDesbloqueados || 0) + 1;
                        }
                    }

                    // C. Calculamos y sumamos la comisión al saldo pendiente
                    if (patrocinador.tipoUsuario === 'afiliado') {
                        if (!patrocinador.comisionesPendientes) patrocinador.comisionesPendientes = 0;
                        patrocinador.comisionesPendientes += comisionesPorNivel[nivel];
                        if (!patrocinador.historialComisiones) patrocinador.historialComisiones = [];
                        patrocinador.historialComisiones.push({
                            fecha: new Date().toISOString(),
                            monto: comisionesPorNivel[nivel],
                            nivel: nivel + 1,
                            deUsuario: email
                        });
                    }
                    
                    patrocinadorActualId = patrocinador.referidoPor;
                }
            }

            escribirPerfiles(perfiles);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: 'El perfil no está pendiente o no existe.' });
        }
    } catch (error) {
        console.error("Error crítico en aprobación administrativa:", error);
        res.status(500).json({ success: false });
    }
});

// --- API: MARCAR COMISIONES COMO PAGADAS ---
router.post('/api/marcar-pagado', (req, res) => {
    try {
        const { email } = req.body;
        const usuarios = leerUsuarios();
        let perfiles = leerPerfiles();

        const cuentaAuth = usuarios.find(user => user.email === email);
        if (!cuentaAuth) return res.status(404).json({ success: false, message: "Usuario no encontrado." });

        const perfilIndex = perfiles.findIndex(p => p.idUnico === cuentaAuth.idUnico);
        if (perfilIndex !== -1) {
            perfiles[perfilIndex].comisionesPendientes = 0; 
            escribirPerfiles(perfiles);
            res.json({ success: true, message: 'Comisión marcada como pagada.' });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// --- API: PAUSAR SUSCRIPCIÓN ---
router.post('/api/pausar-suscripcion', (req, res) => {
    try {
        const { email } = req.body;
        const usuarios = leerUsuarios();
        let perfiles = leerPerfiles();

        const cuentaAuth = usuarios.find(user => user.email === email);
        if (!cuentaAuth) return res.status(404).json({ success: false });

        const perfilIndex = perfiles.findIndex(p => p.idUnico === cuentaAuth.idUnico);
        if (perfilIndex !== -1) {
            perfiles[perfilIndex].suscripcionActiva = false;
            perfiles[perfilIndex].estatusPago = 'pausado';
            escribirPerfiles(perfiles);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// --- API: REACTIVAR SUSCRIPCIÓN ---
router.post('/api/reactivar-suscripcion', (req, res) => {
    try {
        const { email } = req.body;
        const usuarios = leerUsuarios();
        let perfiles = leerPerfiles();

        const cuentaAuth = usuarios.find(user => user.email === email);
        if (!cuentaAuth) return res.status(404).json({ success: false });

        const perfilIndex = perfiles.findIndex(p => p.idUnico === cuentaAuth.idUnico);
        if (perfilIndex !== -1) {
            perfiles[perfilIndex].suscripcionActiva = true;
            perfiles[perfilIndex].estatusPago = 'aprobado';
            escribirPerfiles(perfiles);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// --- API: ELIMINAR PERFIL DE USUARIO ---
router.post('/api/eliminar-usuario', (req, res) => {
    try {
        const { email } = req.body;
        const usuarios = leerUsuarios();
        let perfiles = leerPerfiles();

        const cuentaAuth = usuarios.find(user => user.email === email);
        if (!cuentaAuth) return res.status(404).json({ success: false, message: "No se encontró cuenta de origen." });

        const perfilesFiltrados = perfiles.filter(p => p.idUnico !== cuentaAuth.idUnico);
        if (perfiles.length > perfilesFiltrados.length) {
            escribirPerfiles(perfilesFiltrados);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: "El perfil no existía." });
        }
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

module.exports = router;
