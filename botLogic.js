const api = require("./services/api");

// In-memory session store
// Key: phoneNumber (string)
// Value: { step: string, data: object }
const sessions = new Map();

const STEPS = {
    IDLE: "IDLE",
    BOOKING_ASK_CI: "BOOKING_ASK_CI",
    BOOKING_SELECT_SERVICE: "BOOKING_SELECT_SERVICE",
    BOOKING_SELECT_DENTIST: "BOOKING_SELECT_DENTIST",
    BOOKING_SELECT_DATE: "BOOKING_SELECT_DATE",
    BOOKING_SELECT_SLOT: "BOOKING_SELECT_SLOT",

    REGISTER_ASK_CI: "REGISTER_ASK_CI",
    REGISTER_ASK_FIRST_NAME: "REGISTER_ASK_FIRST_NAME",
    REGISTER_ASK_LAST_NAME: "REGISTER_ASK_LAST_NAME",
    REGISTER_ASK_EMAIL: "REGISTER_ASK_EMAIL",

    MY_APPOINTMENTS_ASK_CI: "MY_APPOINTMENTS_ASK_CI",

    DIAGNOSIS_ASK_SYMPTOM: "DIAGNOSIS_ASK_SYMPTOM",
};

function getSession(number) {
    if (!sessions.has(number)) {
        sessions.set(number, { step: STEPS.IDLE, data: {} });
    }
    return sessions.get(number);
}

function clearSession(number) {
    sessions.set(number, { step: STEPS.IDLE, data: {} });
}

async function handleMessage(number, text) {
    const session = getSession(number);
    const msg = text.trim();

    // Global cancel command
    if (msg.toLowerCase() === "cancelar" || msg.toLowerCase() === "menu") {
        clearSession(number);
        return null; // Return null to trigger main menu in server.js
    }

    try {
        switch (session.step) {
            case STEPS.IDLE:
                return handleIdle(session, msg, number);

            // --- BOOKING FLOW ---
            case STEPS.BOOKING_ASK_CI:
                return await handleBookingAskCI(session, msg);

            case STEPS.BOOKING_SELECT_SERVICE:
                return await handleBookingSelectService(session, msg);

            case STEPS.BOOKING_SELECT_DENTIST:
                return await handleBookingSelectDentist(session, msg);

            case STEPS.BOOKING_SELECT_DATE:
                return await handleBookingSelectDate(session, msg);

            case STEPS.BOOKING_SELECT_SLOT:
                return await handleBookingSelectSlot(session, msg);

            // --- REGISTRATION FLOW ---
            case STEPS.REGISTER_ASK_CI:
                return await handleRegisterAskCI(session, msg);

            case STEPS.REGISTER_ASK_FIRST_NAME:
                session.data.first_name = msg;
                session.step = STEPS.REGISTER_ASK_LAST_NAME;
                return withCancel("Ingresa tu APELLIDO:");

            case STEPS.REGISTER_ASK_LAST_NAME:
                session.data.last_name = msg;
                session.step = STEPS.REGISTER_ASK_EMAIL;
                return withCancel("Ingresa tu EMAIL (o escribe 'no' para omitir):");

            case STEPS.REGISTER_ASK_EMAIL:
                return await handleRegisterFinal(session, msg, number);

            // --- MY APPOINTMENTS ---
            case STEPS.MY_APPOINTMENTS_ASK_CI:
                return await handleMyAppointments(session, msg);

            // --- DIAGNOSIS ---
            case STEPS.DIAGNOSIS_ASK_SYMPTOM:
                return await handleDiagnosis(session, msg);

            default:
                clearSession(number);
                return null;
        }
    } catch (err) {
        console.error("Error in handleMessage:", err);
        clearSession(number);
        return "Ocurrió un error inesperado 😔. Escribe 'menu' para volver al inicio.";
    }
}

// Helper to return response with Cancel button if possible
// NOTE: server.js handles { type: "buttons" ... }
function withCancel(text, title = "DentalCare Bot") {
    // Return button object
    return {
        type: "buttons",
        title: title,
        text: text,
        buttons: [{ id: "cancel", text: "Cancelar" }]
    };
}

// Helper for Lists
function withList(text, title, buttonText, sections) {
    return {
        type: "list",
        text: text, // Sent as separate text message
        title: title, // List title
        buttonText: buttonText,
        sections: sections
    };
}

function handleIdle(session, msg, number) {
    if (msg === "1") {
        session.step = STEPS.BOOKING_ASK_CI;
        return withCancel("🗓️ *Agendar Cita*\n\n¡Claro! Para agendar tu cita, por favor, ingresa tu número de documento de identidad (CI): 🆔");
    }
    if (msg === "2") {
        session.step = STEPS.MY_APPOINTMENTS_ASK_CI;
        return withCancel("📋 *Mis Citas*\n\nPara consultar tus citas pendientes, ingresa tu CI: 🆔");
    }
    if (msg === "3") {
        session.step = STEPS.REGISTER_ASK_CI;
        return withCancel("📝 *Registrarme*\n\n¡Bienvenido/a! Para iniciar tu registro, por favor, ingresa tu CI: 🆔");
    }
    if (msg === "4") {
        session.step = STEPS.DIAGNOSIS_ASK_SYMPTOM;
        return withCancel("🧠 *Diagnóstico IA*\n\nCuéntame, ¿qué molestias tienes? (ej. me duele una muela, tengo sarro...): 🗣️");
    }

    return null; // Triggers menu in server.js
}

// --- BOOKING HANDLERS ---
async function handleBookingAskCI(session, msg) {
    const ci = msg;
    const check = await api.checkPatient(ci);

    if (check.exists) {
        session.data.patient_id = check.patient.id;
        session.data.patient_name = `${check.patient.first_name} ${check.patient.last_name}`;
        session.step = STEPS.BOOKING_SELECT_SERVICE;

        const services = await api.getServices();
        if (!Array.isArray(services) || services.length === 0) {
            session.step = STEPS.IDLE;
            return "Lo siento, no pude obtener la lista de servicios en este momento. Intenta más tarde.";
        }

        session.data.available_services = services;

        // Create List Section
        const rows = services.map(s => ({
            rowId: String(s.id),
            title: s.name,
            description: `$${s.price}`
        }));

        return withList(
            `Hola *${check.patient.first_name}* 👋. ¡Que gusto verte!`,
            "Servicios Disponibles",
            "Ver Servicios",
            [{ title: "Servicios", rows: rows }]
        );
    } else {
        session.step = STEPS.IDLE;
        return "No encontré un paciente con ese CI. ❌\n\nPor favor selecciona opción 3 en el menú principal para registrarte.";
    }
}

async function handleBookingSelectService(session, msg) {
    // 1. Try by ID
    let serviceId = parseInt(msg);
    let service = session.data.available_services.find(s => s.id === serviceId);

    // 2. Try by Name (fuzzy match)
    if (!service) {
        const lowerMsg = msg.toLowerCase();
        service = session.data.available_services.find(s => s.name.toLowerCase().includes(lowerMsg));
    }

    if (!service) return withCancel("Opción inválida. Escribe el número o el nombre del servicio.");

    session.data.service_id = service.id;
    session.data.service_name = service.name;
    session.step = STEPS.BOOKING_SELECT_DENTIST;

    const dentists = await api.getDentists();
    session.data.available_dentists = dentists;

    // ... (rest is same, but careful with existing code context)
    const rows = dentists.map(d => ({
        rowId: String(d.id),
        title: d.name,
        description: d.specialty
    }));

    return withList(
        `Has elegido: *${service.name}*.`,
        "Nuestros Odontólogos",
        "Ver Odontólogos",
        [{ title: "Odontólogos", rows: rows }]
    );
}

// --- REGISTRATION HANDLERS ---
async function handleRegisterAskCI(session, msg) {
    const ci = msg.trim();

    // Validate CI format (basic validation - at least some digits)
    if (!/^\d+$/.test(ci)) {
        return withCancel("❌ El CI debe contener solo números. Por favor ingresa un CI válido:");
    }

    // Check if patient already exists
    const check = await api.checkPatient(ci);

    if (check.exists) {
        session.step = STEPS.IDLE;
        return `✅ Ya estás registrado/a como *${check.patient.first_name} ${check.patient.last_name}*.\n\nPuedes agendar una cita seleccionando la opción 1 del menú principal.`;
    }

    // Patient doesn't exist, proceed with registration
    session.data.ci = ci;
    session.step = STEPS.REGISTER_ASK_FIRST_NAME;
    return withCancel("Ingresa tu NOMBRE:");
}

async function handleRegisterFinal(session, msg, number) {
    const email = msg.toLowerCase() === 'no' ? null : msg;
    session.data.email = email;

    const registerData = {
        first_name: session.data.first_name,
        last_name: session.data.last_name,
        ci: session.data.ci,
        email: session.data.email,
        phone: String(number) // ✅ ESTE
    };

    const result = await api.registerPatient(registerData);
    session.step = STEPS.IDLE;

    if (result.success) {
        return `✅ Registro exitoso. Bienvenido/a ${session.data.first_name}.\n\nAhora puedes agendar tu cita seleccionando la opción 1 del menú principal.`;
    } else {
        return "❌ Error al registrar. Intenta más tarde.";
    }
}

async function handleBookingSelectDentist(session, msg) {
    const dentistId = parseInt(msg);
    const dentist = session.data.available_dentists.find(d => d.id === dentistId);

    if (!dentist) return withCancel("Opción inválida. Por favor selecciona un odontólogo de la lista.");

    session.data.dentist_id = dentist.id;
    session.data.dentist_name = dentist.name;
    session.step = STEPS.BOOKING_SELECT_DATE;

    return withCancel(`👨‍⚕️ Con el Dr. *${dentist.name}*.\n\n📅 Por favor ingresa la fecha deseada (AAAA-MM-DD)\nEjemplo: *2026-02-01*`);
}

async function handleBookingSelectDate(session, msg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(msg)) {
        return withCancel("Formato incorrecto. Usa AAAA-MM-DD, ejemplo: 2026-02-01");
    }

    const date = msg;
    session.data.date = date;

    const slots = await api.getSlots(session.data.dentist_id, session.data.service_id, date);

    if (!Array.isArray(slots) || slots.length === 0) {
        return withCancel("No hay turnos disponibles para esa fecha (o no pude consultar la agenda). 😔\nPor favor ingresa otra fecha (YYYY-MM-DD):");
    }

    session.data.available_slots = slots;
    session.step = STEPS.BOOKING_SELECT_SLOT;

    const rows = slots.map(slot => ({
        rowId: slot,
        title: slot,
        description: "Disponible"
    }));

    return withList(
        `Horarios disponibles para el ${date}:`,
        "Turnos Disponibles",
        "Ver Turnos",
        [{ title: "Horarios", rows: rows }]
    );
}

async function handleBookingSelectSlot(session, msg) {
    const slot = session.data.available_slots.find(s => s === msg.trim());

    if (!slot) return withCancel("Hora no válida. Selecciona una de la lista.");

    session.data.start_time = slot;

    // Book it
    const bookingData = {
        patient_id: session.data.patient_id,
        dentist_id: session.data.dentist_id,
        service_id: session.data.service_id,
        date: session.data.date,
        time: slot,
        notes: "Reserva desde WhatsApp Bot"
    };

    const result = await api.bookAppointment(bookingData);
    session.step = STEPS.IDLE; // Done

    console.log("🔍 Booking Result:", JSON.stringify(result, null, 2));

    // Backend returns { message: "...", appointment_id: ... }, not "success: true"
    if (result && (result.success || result.appointment_id || result.message)) {
        // Construct details from session data since backend doesn't verify them in response
        return `✅ *Cita Reservada*\n\n📌 Servicio: ${session.data.service_name}\n👨‍⚕️ Dr.: ${session.data.dentist_name}\n📅 Fecha: ${session.data.date} a las ${slot}\n\n¡Te esperamos!`;
    } else {
        return "❌ Error al reservar la cita. Por favor intenta de nuevo.";
    }
}

// ...

// --- MY APPOINTMENTS ---
async function handleMyAppointments(session, msg) {
    const ci = msg;

    // 1. Verify patient logic fix
    const check = await api.checkPatient(ci);
    if (!check.exists) {
        session.step = STEPS.IDLE;
        return "🚫 No se encontró ningún paciente registrado con ese CI.\n\nUsa la opción 3 para registrarte.";
    }

    // 2. Get appointments
    const appointments = await api.getMyAppointments(ci);
    session.step = STEPS.IDLE;

    if (!Array.isArray(appointments) || appointments.length === 0) {
        return `Hola ${check.patient.first_name}. No tienes citas futuras agendas (o ocurrió un error al consultar).`;
    }

    let text = `📋 *Tus Próximas Citas* (${check.patient.first_name}):\n`;
    const statusMap = {
        reserved: "Reservada",
        confirmed: "Confirmada",
        cancelled: "Cancelada",
        completed: "Completada"
    };

    appointments.forEach(app => {
        const dateRaw = app.date || "";
        const date = dateRaw.split("T")[0]; // Take only YYYY-MM-DD
        const status = statusMap[app.status] || app.status; // Translate or keep original

        text += `\n🔹 ${date} ${app.time}\n   ${app.service} con ${app.dentist}\n   Estado: ${status}\n`;
    });

    return text;
}

// --- DIAGNOSIS ---
async function handleDiagnosis(session, msg) {
    const text = msg;
    const result = await api.getDiagnosis(text);

    session.step = STEPS.IDLE;

    let message = result.message || "Resultado:";

    // UX Improvement: If API says "No se encontraron..." but returns services (like General Consultation), replace message.
    if (message.includes("No se encontraron") && result.suggested_services && result.suggested_services.length > 0) {
        message = "No encontré un servicio exacto para eso, pero te sugiero una evaluación general:";
    }

    let resp = `🤖 ${message}\n`;

    // Fix: check for price existence to avoid "undefined"
    if (result.suggested_services && result.suggested_services.length > 0) {
        result.suggested_services.forEach(s => {
            const priceText = s.price !== undefined ? `$${s.price}` : "Precio a consultar";
            resp += `\n✨ *${s.name}* (${priceText})`;
        });
        resp += "\n\nPuedes agendar estos servicios en el menú principal.";
    }

    return resp;
}

module.exports = { handleMessage, getSession };
