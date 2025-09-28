const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();

const USUARIOS_DB_PATH = path.join(__dirname, '..', 'usuarios.json');
const PERFILES_DB_PATH = path.join(__dirname, '..', 'perfiles.json');

function leerUsuarios() {
    try {
        if (fs.existsSync(USUARIOS_DB_PATH)) {
            return JSON.parse(fs.readFileSync(USUARIOS_DB_PATH, 'utf8'));
        }
    } catch (e) {
        console.error("Error al leer usuarios.json:", e);
    }
    return [];
}

function escribirUsuarios(data) {
    try {
        fs.writeFileSync(USUARIOS_DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Error al escribir en usuarios.json:", e);
    }
}

function leerPerfiles() {
    try {
        if (fs.existsSync(PERFILES_DB_PATH)) {
            return JSON.parse(fs.readFileSync(PERFILES_DB_PATH, 'utf8'));
        }
    } catch (e) {
        console.error("Error al leer perfiles.json:", e);
    }
    return [];
}

function escribirPerfiles(data) {
    try {
        fs.writeFileSync(PERFILES_DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Error al escribir en perfiles.json:", e);
    }
}

// --- RUTA DE REGISTRO ---
router.post('/procesar-registro', async (req, res) => {
    try {
        const { name, email, password, confirmPassword, fechaNacimiento, pais, telefono, codigoReferido } = req.body;
        const usuarios = leerUsuarios();

        if (usuarios.find(u => u.email === email)) {
            return res.status(400).send('<h1>Error: El email ya está registrado. <a href="/login.html">Volver</a></h1>');
        }
        if (password !== confirmPassword) {
            return res.status(400).send('<h1>Error: Las contraseñas no coinciden. <a href="/login.html">Volver</a></h1>');
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const idUnico = `usr_${Date.now()}`;
        
        const nuevoUsuario = { idUnico, email, password: hashedPassword };
        usuarios.push(nuevoUsuario);
        escribirUsuarios(usuarios);

        const perfiles = leerPerfiles();
        let patrocinador = null;
        if (codigoReferido) {
            patrocinador = perfiles.find(p => p.codigoReferido === codigoReferido);
        }

        const nuevoPerfil = {
            idUnico, name, fechaNacimiento, pais, telefono,
            rol: 'usuario', tipoUsuario: 'afiliado',
            suscripcionActiva: false, estatusPago: 'pendiente_pago',
            fechaRegistro: new Date().toISOString(),
            fechaVencimientoSuscripcion: null,
            walletBTC: null,
            referidoPor: patrocinador ? patrocinador.idUnico : null,
            codigoReferido: `${name.split(' ')[0].toUpperCase()}${crypto.randomInt(100, 999)}`,
            conteoReferidosDirectos: 0, conteoReferidosTotales: 0,
            bonosDesbloqueados: 0, comisionesPendientes: 0,
            historialPagos: [],
            comisionesPagadas: []
        };
        perfiles.push(nuevoPerfil);
        escribirPerfiles(perfiles);
        
        req.session.idUnico = idUnico;
        res.redirect('/pago.html');

    } catch (error) {
        console.error("Error en el registro:", error);
        res.status(500).send('<h1>Error interno del servidor.</h1>');
    }
});
// --- RUTA DE LOGIN ---
router.post('/procesar-login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const usuarios = leerUsuarios();
        const usuario = usuarios.find(u => u.email === email);

        if (usuario && await bcrypt.compare(password, usuario.password)) {
            // Contraseña correcta, ahora verificamos el perfil
            const perfiles = leerPerfiles();
            const perfil = perfiles.find(p => p.idUnico === usuario.idUnico);

            // Verificamos que el perfil exista y que la suscripción esté activa
            if (perfil && perfil.suscripcionActiva) {
                req.session.idUnico = usuario.idUnico;
                res.redirect('/dashboard.html');
            } else {
                // Si no está activo, enviamos un mensaje de error
                res.status(403).send('<h1>Acceso denegado. Tu cuenta no ha sido aprobada o está inactiva. <a href="/login.html">Volver</a></h1>');
            }
            
        } else {
            res.status(401).send('<h1>Email o contraseña incorrectos. <a href="/login.html">Volver</a></h1>');
        }
    } catch (error) {
        console.error("Error en el login:", error);
        res.status(500).send('<h1>Error interno del servidor.</h1>');
    }
});

// --- RUTA PARA CONFIRMAR EL PAGO ---
router.post('/confirmar-pago', (req, res) => {
    try {
        const { txid } = req.body;
        const idUnico = req.session.idUnico; // Obtenemos el ID del usuario de la sesión

        if (!idUnico) {
            return res.status(401).send('<h1>Error: Sesión no encontrada. Por favor, regístrate de nuevo.</h1>');
        }

        let perfiles = leerPerfiles();
        const perfilIndex = perfiles.findIndex(p => p.idUnico === idUnico);

        if (perfilIndex !== -1) {
            perfiles[perfilIndex].txid = txid;
            perfiles[perfilIndex].estatusPago = 'pendiente_verificacion';
            perfiles[perfilIndex].fechaReportePago = new Date().toISOString();
            escribirPerfiles(perfiles);
            
            res.send('<h1>¡Gracias! Tu pago está siendo verificado. Serás notificado por el administrador cuando tu cuenta sea aprobada.</h1>');
        } else {
            res.status(404).send('<h1>Perfil de usuario no encontrado.</h1>');
        }
    } catch (error) {
        console.error("Error al confirmar pago:", error);
        res.status(500).send('<h1>Error interno del servidor.</h1>');
    }
});
// --- RUTA PARA SOLICITAR UN CÓDIGO DE RESETEO (VERSIÓN FINAL) ---
router.post('/api/solicitar-reset', (req, res) => {
    try {
        const { email } = req.body;
        let usuarios = leerUsuarios();
        const usuarioIndex = usuarios.findIndex(u => u.email === email);

        if (usuarioIndex !== -1) {
            // Generamos un código numérico de 6 dígitos
            const resetCode = crypto.randomInt(100000, 999999).toString();
            // El código expira en 2 HORAS
            const expiration = Date.now() + 2 * 60 * 60 * 1000; 

            // Guardamos el código y su expiración en el perfil del usuario
            usuarios[usuarioIndex].resetPasswordCode = resetCode;
            usuarios[usuarioIndex].resetPasswordExpires = expiration;
            usuarios[usuarioIndex].resetCodeHandled = false; // Marcamos como no atendido
            
            escribirUsuarios(usuarios);
            console.log(`Código de reseteo para ${email}: ${resetCode}`);
        }
        
        // Enviamos siempre una respuesta genérica por seguridad
        res.json({ success: true, message: 'Si tu correo está registrado, un administrador se pondrá en contacto contigo.' });

    } catch (error) {
        console.error("Error al solicitar reseteo:", error);
        res.status(500).json({ success: false, message: 'Error en el servidor.' });
    }
});

// --- RUTA PARA REALIZAR EL RESETEO CON EL CÓDIGO ---
router.post('/api/realizar-reset', async (req, res) => {
    try {
        const { email, resetCode, newPassword } = req.body;
        let usuarios = leerUsuarios();
        const usuarioIndex = usuarios.findIndex(u => u.email === email);

        if (usuarioIndex === -1) {
            return res.status(400).json({ success: false, message: 'El código o el email no son válidos.' });
        }
        
        const usuario = usuarios[usuarioIndex];

        // Verificamos que el código sea correcto y no haya expirado
        if (usuario.resetPasswordCode !== resetCode || Date.now() > usuario.resetPasswordExpires) {
            return res.status(400).json({ success: false, message: 'El código o el email no son válidos.' });
        }

        // Si todo es correcto, actualizamos la contraseña
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        usuarios[usuarioIndex].password = hashedPassword;
        // Eliminamos el código para que no se pueda volver a usar
        delete usuarios[usuarioIndex].resetPasswordCode;
        delete usuarios[usuarioIndex].resetPasswordExpires;

        escribirUsuarios(usuarios);
        res.json({ success: true, message: '¡Contraseña actualizada con éxito!' });

    } catch (error) {
        console.error("Error al realizar reseteo:", error);
        res.status(500).json({ success: false, message: 'Error en el servidor.' });
    }
});

module.exports = router;