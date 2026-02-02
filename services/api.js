const axios = require("axios");

const API_Base = process.env.API_BASE_URL || "http://localhost:8000/api/bot";

const api = axios.create({
  baseURL: API_Base,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  validateStatus: () => true, // Handle errors manually
});

api.interceptors.response.use(response => {
  // Log failures
  if (response.status >= 300) {
    console.error(`❌ API Error [${response.config.url}]: ${response.status}`, response.data);
  }
  return response;
}, error => {
  console.error(`❌ Network Error [${error.config?.url}]:`, error.message);
  return Promise.reject(error);
});

async function checkConnection() {
  try {
    console.log(`📡 Testing connection to: ${API_Base}/services ...`);
    const res = await api.get("/services");
    console.log(`✅ API Connection OK! (Status: ${res.status})`);
    return true;
  } catch (error) {
    console.error(`❌ API Connection FAILED: ${error.message}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, JSON.stringify(error.response.data));
    }
    return false;
  }
}


async function checkPatient(identifier) {
  try {
    const res = await api.post("/check-patient", { identifier });
    return res.data;
  } catch (error) {
    console.error("API Error checkPatient:", error.message);
    return { exists: false, error: true };
  }
}

async function registerPatient(data) {
  try {
    const res = await api.post("/register", data);
    return res.data;
  } catch (error) {
    console.error("API Error registerPatient:", error.message);
    return { success: false, error: true };
  }
}

async function getServices() {
  try {
    const res = await api.get("/services");
    return res.data;
  } catch (error) {
    console.error("API Error getServices:", error.message);
    return [];
  }
}

async function getDentists() {
  try {
    const res = await api.get("/dentists");
    return res.data;
  } catch (error) {
    console.error("API Error getDentists:", error.message);
    return [];
  }
}

async function getSlots(dentist_id, service_id, date) {
  try {
    const res = await api.post("/slots", { dentist_id, service_id, date });
    // Expecting { slots: [...] }
    return Array.isArray(res.data.slots) ? res.data.slots : [];
  } catch (error) {
    console.error("API Error getSlots:", error.message);
    return [];
  }
}

async function bookAppointment(data) {
  try {
    const res = await api.post("/book", data);
    return res.data;
  } catch (error) {
    console.error("API Error bookAppointment:", error.message);
    return { success: false, error: true };
  }
}

async function getMyAppointments(identifier) {
  try {
    const res = await api.post("/my-appointments", { identifier });
    // Expecting { appointments: [...] }
    return Array.isArray(res.data.appointments) ? res.data.appointments : [];
  } catch (error) {
    console.error("API Error getMyAppointments:", error.message);
    return [];
  }
}

async function getDiagnosis(text) {
  try {
    console.log("🤖 Sending to AI API:", { text });
    const res = await api.post("/diagnosis", { text });
    console.log("🤖 AI Response:", JSON.stringify(res.data));
    // Ensure we return a structure even if payload is weird
    return res.data || { message: "Sin respuesta de IA", suggested_services: [] };
  } catch (error) {
    console.error("API Error getDiagnosis:", error.message);
    if (error.response) console.error("Data:", error.response.data);
    return { message: "Error al consultar IA", suggested_services: [] };
  }
}

module.exports = {
  checkConnection, // ✅ Exported
  checkPatient,

  registerPatient,
  getServices,
  getDentists,
  getSlots,
  bookAppointment,
  getMyAppointments,
  getDiagnosis,
};
