const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// --- RUTAS A LAS BASES DE DATOS ---
const USUARIOS_DB_PATH = path.join(__dirname, '..', 'usuarios.json');
const PERFILES_DB_PATH = path.join(__dirname, '..', 'perfiles.json');
const CURSOS_DB_PATH = path.join(__dirname, '..', 'cursos.json');
const HERRAMIENTAS_DB_PATH = path.join(__dirname, '..', 'herramientas.json');


// --- FUNCIONES DE AYUDA ---
function leerArchivo(ruta) {
    try {
        if (fs.existsSync(ruta)) return JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch (e) { console.error(`Error al leer ${ruta}:`, e); }
    return [];
}
function escribirArchivo(ruta, data) {
    try {
        fs.writeFileSync(ruta, JSON.stringify(data, null, 2));
    } catch (e) { console.error(`Error al escribir en ${ruta}:`, e); }
}
function leerUsuarios() { return leerArchivo(USUARIOS_DB_PATH); }
function leerPerfiles() { return leerArchivo(PERFILES_DB_PATH); }
function escribirUsuarios(data) { escribirArchivo(USUARIOS_DB_PATH, data); }
function escribirPerfiles(data) { escribirArchivo(PERFILES_DB_PATH, data); }

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

function verificarAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    return res.status(401).json({ error: 'Acceso denegado' });
}

// --- LOGIN DEL ADMINISTRADOR ---
router.post('/procesar-admin-login', (req, res) => {
    const { email, password } = req.body;
    if (email === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        req.session.isAdmin = true;
        return res.redirect('/admin_usuarios.html');
    } else {
        res.status(401).send('<h1>Error de credenciales.</h1>');
    }
});

// --- RUTAS DE GESTIÓN DE USUARIOS ---
router.get('/api/todos-los-usuarios', verificarAdmin, (req, res) => {
    try {
        const perfiles = leerPerfiles();
        const usuarios = leerUsuarios();
        const emailMap = new Map(usuarios.map(u => [u.idUnico, u.email]));
        let usuariosCombinados = perfiles.map(perfil => {
            const email = emailMap.get(perfil.idUnico) || 'Email no encontrado';
            const rango = calcularRango(perfil.conteoReferidosTotales || 0);
            let diasRestantes = 0;
            if (perfil.suscripcionActiva && perfil.fechaVencimientoSuscripcion) {
                const diff = new Date(perfil.fechaVencimientoSuscripcion) - new Date();
                diasRestantes = diff > 0 ? Math.ceil(diff / (1000 * 3600 * 24)) : 0;
            }
            return { ...perfil, email, rango, diasRestantes };
        });

        usuariosCombinados.sort((a, b) => {
            if (a.estatusPago === 'pendiente_verificacion' && b.estatusPago !== 'pendiente_verificacion') return -1;
            if (b.estatusPago === 'pendiente_verificacion' && a.estatusPago !== 'pendiente_verificacion') return 1;
            return new Date(b.fechaRegistro) - new Date(a.fechaRegistro);
        });

        res.json(usuariosCombinados);
    } catch (error) {
        console.error("Error al combinar usuarios para admin:", error);
        res.status(500).json({ error: "Error al combinar las bases de datos." });
    }
});
router.post('/api/aprobar-usuario', verificarAdmin, (req, res) => {
    try {
        const { email } = req.body;
        const usuarios = leerUsuarios();
        const usuarioAuth = usuarios.find(u => u.email === email);
        if (!usuarioAuth) return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });

        let perfiles = leerPerfiles();
        const perfilIndex = perfiles.findIndex(p => p.idUnico === usuarioAuth.idUnico);
        if (perfilIndex !== -1 && perfiles[perfilIndex].estatusPago === 'pendiente_verificacion') {
            const perfilAprobado = perfiles[perfilIndex];
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

            if (perfilAprobado.referidoPor) {
                const comisionesPorNivel = [12.50, 7.50, 2.50, 1.50, 1.00];
                let patrocinadorActualId = perfilAprobado.referidoPor;
                for (let nivel = 0; nivel < 5 && patrocinadorActualId; nivel++) {
                    const patrocinadorIndex = perfiles.findIndex(p => p.idUnico === patrocinadorActualId);
                    if (patrocinadorIndex === -1) break;
                    const patrocinador = perfiles[patrocinadorIndex];
                    patrocinador.conteoReferidosTotales = (patrocinador.conteoReferidosTotales || 0) + 1;
                    if (nivel === 0) {
                        patrocinador.conteoReferidosDirectos = (patrocinador.conteoReferidosDirectos || 0) + 1;
                    }
                    if(patrocinador.tipoUsuario === 'afiliado'){
                        patrocinador.comisionesPendientes = (patrocinador.comisionesPendientes || 0) + comisionesPorNivel[nivel];
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
            res.status(404).json({ success: false, message: 'Perfil no encontrado o ya no está pendiente.' });
        }
    } catch (error) {
        console.error("Error al aprobar usuario:", error);
        res.status(500).json({ success: false, message: 'Error interno.' });
    }
});

function modificarPerfilPorEmail(email, callback) {
    const usuarios = leerUsuarios();
    const usuarioAuth = usuarios.find(u => u.email === email);
    if (!usuarioAuth) return false;
    let perfiles = leerPerfiles();
    const perfilIndex = perfiles.findIndex(p => p.idUnico === usuarioAuth.idUnico);
    if (perfilIndex !== -1) {
        callback(perfiles[perfilIndex]);
        escribirPerfiles(perfiles);
        return true;
    }
    return false;
}

router.post('/api/pausar-suscripcion', verificarAdmin, (req, res) => {
    const exito = modificarPerfilPorEmail(req.body.email, perfil => {
        perfil.suscripcionActiva = false;
    });
    res.json({ success: exito });
});

router.post('/api/reactivar-suscripcion', verificarAdmin, (req, res) => {
    const exito = modificarPerfilPorEmail(req.body.email, perfil => {
        perfil.suscripcionActiva = true;
    });
    res.json({ success: exito });
});
function eliminarUsuarioCompleto(email) {
    let usuarios = leerUsuarios();
    const usuarioAuth = usuarios.find(u => u.email === email);
    if (!usuarioAuth) return false;

    escribirUsuarios(usuarios.filter(u => u.email !== email));
    
    let perfiles = leerPerfiles();
    escribirPerfiles(perfiles.filter(p => p.idUnico !== usuarioAuth.idUnico));
    
    return true;
}

router.post('/api/denegar-usuario', verificarAdmin, (req, res) => {
    try {
        const exito = eliminarUsuarioCompleto(req.body.email);
        res.json({ success: exito });
    } catch (error) {
        console.error("Error al denegar usuario:", error);
        res.status(500).json({ success: false, message: 'Error en servidor.' });
    }
});

router.post('/api/eliminar-usuario', verificarAdmin, (req, res) => {
    try {
        const exito = eliminarUsuarioCompleto(req.body.email);
        res.json({ success: exito });
    } catch (error) {
        console.error("Error al eliminar usuario:", error);
        res.status(500).json({ success: false, message: 'Error en servidor.' });
    }
});

router.get('/api/usuario/:email', verificarAdmin, (req, res) => {
    try {
        const { email } = req.params;
        const usuarios = leerUsuarios();
        const perfiles = leerPerfiles();
        const emailMap = new Map(usuarios.map(u => [u.idUnico, u.email]));
        
        const usuarioAuth = usuarios.find(u => u.email === email);
        if (!usuarioAuth) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const perfilEncontrado = perfiles.find(p => p.idUnico === usuarioAuth.idUnico);
        if (perfilEncontrado) {
            const rango = calcularRango(perfilEncontrado.conteoReferidosTotales || 0);

            let redCompleta = [];
            function encontrarReferidos(idPadre, nivel) {
                if (nivel > 5) return;
                const referidosDirectos = perfiles.filter(p => p.referidoPor === idPadre);

                referidosDirectos.forEach(ref => {
                    redCompleta.push({
                        name: ref.name,
                        email: emailMap.get(ref.idUnico) || 'N/A',
                        nivel: nivel,
                        fechaRegistro: ref.fechaRegistro,
                        suscripcionActiva: ref.suscripcionActiva
                    });
                    encontrarReferidos(ref.idUnico, nivel + 1);
                });
            }
            encontrarReferidos(perfilEncontrado.idUnico, 1);

            const datosCompletos = { 
                ...perfilEncontrado, 
                email: usuarioAuth.email, 
                rango: rango,
                referidos: redCompleta
            };
            res.json(datosCompletos);

        } else {
            res.status(404).json({ error: "Perfil no encontrado" });
        }
    } catch (error) {
        console.error("Error en /api/usuario/:email :", error);
        res.status(500).json({ error: "Error en el servidor." });
    }
});


// --- RUTAS DE PAGOS ---
router.get('/api/comisiones-por-pagar', verificarAdmin, (req, res) => {
    try {
        const perfiles = leerPerfiles();
        const usuarios = leerUsuarios();
        const emailMap = new Map(usuarios.map(u => [u.idUnico, u.email]));
        
        const listaDePagos = perfiles
            .filter(user => user.tipoUsuario === 'afiliado' && user.walletBTC && (user.comisionesPendientes || 0) > 0)
            .map(afiliado => {
                // Buscamos la fecha de la última comisión generada
                let fechaUltimaComision = afiliado.fechaRegistro; // Usamos fecha de registro como base
                if (afiliado.historialComisiones && afiliado.historialComisiones.length > 0) {
                    fechaUltimaComision = afiliado.historialComisiones[afiliado.historialComisiones.length - 1].fecha;
                }
                
                return {
                    idUnico: afiliado.idUnico,
                    name: afiliado.name,
                    email: emailMap.get(afiliado.idUnico) || 'Email no encontrado',
                    walletBTC: afiliado.walletBTC,
                    montoAPagar: afiliado.comisionesPendientes,
                    fechaUltimaComision: fechaUltimaComision // <-- Enviamos la nueva fecha
                };
            });
            
        res.json(listaDePagos);
    } catch (error) {
        console.error("Error al preparar la lista de pagos:", error);
        res.status(500).json({ error: "Error al preparar la lista de pagos." });
    }
});

router.post('/api/marcar-pagado', verificarAdmin, (req, res) => {
    try {
        const { idUnico, esAdelantado, txid } = req.body;
        if (!txid || txid.trim() === '') {
            return res.status(400).json({ success: false, message: 'El ID de transacción (TXID) no puede estar vacío.' });
        }
        let perfiles = leerPerfiles();
        const perfilIndex = perfiles.findIndex(user => user.idUnico === idUnico);
        if (perfilIndex !== -1) {
            const perfil = perfiles[perfilIndex];
            const montoPagado = perfil.comisionesPendientes;
            if (!perfil.comisionesPagadas) perfil.comisionesPagadas = [];
            perfil.comisionesPagadas.push({
                fecha: new Date().toISOString(),
                monto: montoPagado,
                tipo: esAdelantado ? 'Adelantado' : 'Regular',
                txid: txid
            });
            perfil.comisionesPendientes = 0;
            escribirPerfiles(perfiles);
            res.json({ success: true, message: 'Comisión marcada como pagada.' });
        } else {
            res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        }
    } catch (error) {
        console.error("Error al marcar como pagado:", error);
        res.status(500).json({ success: false, message: 'Error en el servidor.' });
    }
});

router.get('/api/pagos-realizados', verificarAdmin, (req, res) => {
    try {
        const perfiles = leerPerfiles();
        const usuarios = leerUsuarios();
        const emailMap = new Map(usuarios.map(u => [u.idUnico, u.email]));
        let historial = [];
        perfiles.forEach(perfil => {
            if (perfil.comisionesPagadas && perfil.comisionesPagadas.length > 0) {
                perfil.comisionesPagadas.forEach(pago => {
                    historial.push({
                        name: perfil.name,
                        email: emailMap.get(perfil.idUnico) || 'N/A',
                        monto: pago.monto,
                        fecha: pago.fecha,
                        tipo: pago.tipo || 'Regular',
                        txid: pago.txid || 'N/A'
                    });
                });
            }
        });
        historial.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        res.json(historial);
    } catch (error) {
        console.error("Error al obtener historial de pagos:", error);
        res.status(500).json({ error: "Error al obtener el historial." });
    }
});
// --- RUTA PARA VER LOS CÓDIGOS DE RESETEO ---
router.get('/api/resets-pendientes', verificarAdmin, (req, res) => {
    try {
        const usuarios = leerUsuarios();
        const solicitudes = usuarios
            .filter(u => u.resetPasswordCode && u.resetPasswordExpires > Date.now() && !u.resetCodeHandled)
            .map(u => ({
                email: u.email,
                resetPasswordCode: u.resetPasswordCode
            }));
        
        solicitudes.sort((a, b) => {
            // Esto es para asegurar que siempre aparezcan en el mismo orden, se puede quitar si no es necesario.
            return a.email.localeCompare(b.email);
        });

        res.json(solicitudes);
    } catch (error) {
        res.status(500).json([]);
    }
});

// --- RUTA PARA MARCAR UN CÓDIGO COMO ATENDIDO ---
router.post('/api/marcar-reset-copiado', verificarAdmin, (req, res) => {
    try {
        const { email } = req.body;
        let usuarios = leerUsuarios();
        const usuarioIndex = usuarios.findIndex(u => u.email === email);
        if (usuarioIndex !== -1) {
            usuarios[usuarioIndex].resetCodeHandled = true;
            escribirUsuarios(usuarios);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// --- API PARA LA PÁGINA DE ESTADÍSTICAS ---
router.get('/api/estadisticas', verificarAdmin, (req, res) => {
    try {
        const perfiles = leerPerfiles();
        const PRECIO_SUSCRIPCION = 50;
        const totalUsuarios = perfiles.length;
        const usuariosActivos = perfiles.filter(p => p.suscripcionActiva).length;
        const ingresosBrutosTotales = perfiles.reduce((sum, p) => sum + (p.historialPagos || []).reduce((sub, pago) => sub + pago.monto, 0), 0);
        const comisionesPagadasTotales = perfiles.reduce((sum, p) => sum + (p.comisionesPagadas || []).reduce((sub, pago) => sub + pago.monto, 0), 0);
        const comisionesPorPagar = perfiles.reduce((sum, p) => sum + (p.comisionesPendientes || 0), 0);
        const gananciaNetaReal = ingresosBrutosTotales - comisionesPagadasTotales - comisionesPorPagar;
        const ingresosProyectados = usuariosActivos * PRECIO_SUSCRIPCION;
        res.json({
            totalUsuarios,
            usuariosActivos,
            ingresosBrutos: ingresosBrutosTotales,
            comisionesPagadas: comisionesPagadasTotales,
            comisionesPendientes: comisionesPorPagar,
            gananciaNetaReal: gananciaNetaReal,
            ingresosProyectados
        });
    } catch (error) {
        console.error("Error al calcular estadísticas:", error);
        res.status(500).json({ error: "Error en servidor." });
    }
});

// --- RUTAS PARA GESTIÓN DE CONTENIDO ---
router.get('/api/contenido/:tipo', verificarAdmin, (req, res) => {
    const { tipo } = req.params;
    const rutaArchivo = tipo === 'cursos' ? CURSOS_DB_PATH : HERRAMIENTAS_DB_PATH;
    res.json(leerArchivo(rutaArchivo));
});

router.post('/api/contenido/:tipo', verificarAdmin, (req, res) => {
    const { tipo } = req.params;
    const rutaArchivo = tipo === 'cursos' ? CURSOS_DB_PATH : HERRAMIENTAS_DB_PATH;
    let contenido = leerArchivo(rutaArchivo);
    const nuevoItem = {
        id: `${tipo.slice(0, -1)}_${Date.now()}`,
        ...req.body
    };
    contenido.push(nuevoItem);
    escribirArchivo(rutaArchivo, contenido);
    res.json({ success: true, item: nuevoItem });
});

router.put('/api/contenido/:tipo/:id', verificarAdmin, (req, res) => {
    const { tipo, id } = req.params;
    const rutaArchivo = tipo === 'cursos' ? CURSOS_DB_PATH : HERRAMIENTAS_DB_PATH;
    let contenido = leerArchivo(rutaArchivo);
    const index = contenido.findIndex(item => item.id === id);
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Contenido no encontrado.' });
    }
    contenido[index] = { ...contenido[index], ...req.body };
    escribirArchivo(rutaArchivo, contenido);
    res.json({ success: true, item: contenido[index] });
});

router.delete('/api/contenido/:tipo/:id', verificarAdmin, (req, res) => {
    try { 
        const { tipo, id } = req.params;
        const rutaArchivo = tipo === 'cursos' ? CURSOS_DB_PATH : HERRAMIENTAS_DB_PATH;
        let contenido = leerArchivo(rutaArchivo);
        const nuevoContenido = contenido.filter(item => item.id !== id);
        
        if (contenido.length === nuevoContenido.length) {
            return res.status(404).json({ success: false, message: 'Contenido no encontrado.' });
        }
        
        escribirArchivo(rutaArchivo, nuevoContenido);
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ success: false });
    }
});
module.exports = router;