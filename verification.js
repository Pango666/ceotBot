const botLogic = require("./botLogic");
const api = require("./services/api");

// MOCK API
api.checkPatient = async (id) => {
    // console.log("[MOCK] checking patient", id);
    if (id === "1234567") {
        return { exists: true, patient: { id: 15, first_name: "Juan", last_name: "Perez" } };
    }
    return { exists: false };
};

api.getServices = async () => {
    return [
        { id: 1, name: "Consulta General", price: 100 },
        { id: 2, name: "Limpieza", price: 150 }
    ];
};

api.getDentists = async () => {
    return [{ id: 5, name: "Dr. Roberto", specialty: "Ortodoncia" }];
};

api.getSlots = async () => {
    return ["09:00", "10:00"];
};

api.bookAppointment = async () => {
    return { success: true, details: { date: "2026-02-01", time: "09:00", dentist: "Dr. Roberto", service: "Consulta General" } };
};


async function runTest() {
    const number = "59160012345";
    console.log("--- START TEST ---");

    // 1. User sends "1" (Should return buttons object)
    let response = await botLogic.handleMessage(number, "1");
    // console.log("User: 1");
    console.log("Bot Response Type (1):", typeof response, response?.type);
    console.log("Text (delivered first):", response?.text);
    // console.log("Response:", JSON.stringify(response, null, 2));

    // 2. User sends "1234567" (CI) -> Should return List (Services)
    response = await botLogic.handleMessage(number, "1234567");
    console.log("Bot Response Type (Services List):", typeof response, response?.type);
    console.log("Section Title:", response?.sections?.[0]?.title);
    console.log("Rows:", response?.sections?.[0]?.rows.length);

    // 3. User selects service 1 (List test)
    console.log("--- Testing List Click (Service 1) ---");
    response = await botLogic.handleMessage(number, "1"); // Assuming user clicks rowId "1"
    console.log("Bot Response Type (Dentists List):", typeof response, response?.type);

    // 4. User selects dentist 5
    response = await botLogic.handleMessage(number, "5");
    console.log("Bot Response Type (Date Prompt):", typeof response, response?.type);

    // 5. User selects date
    response = await botLogic.handleMessage(number, "2026-02-01");
    console.log("Bot Response Type (Slots List):", typeof response, response?.type);

    // 6. Diagnosis test (Fix check)
    // Mock api diagnosis result to match the "No specific services" case
    const originalGetDiagnosis = api.getDiagnosis;
    api.getDiagnosis = async () => ({
        message: "No se encontraron servicios especificos para esa descripcion te recomendamos una consulta general",
        suggested_services: [{ id: 1, name: "Consulta General", price: 100 }]
    });

    // Reset session before diagnosis
    await botLogic.handleMessage(number, "cancelar");

    console.log("--- Testing Diagnosis Fix ---");
    response = await botLogic.handleMessage(number, "4"); // Diagnosis flow
    response = await botLogic.handleMessage(number, "Me duele todo");
    console.log("User: Me duele todo");
    console.log("Bot (Diagnosis Result):", response); // Should say "Basado en tu descripción..."

    // Restore
    api.getDiagnosis = originalGetDiagnosis;

    console.log("--- TEST END ---");
}

runTest();
