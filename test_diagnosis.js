const api = require("./services/api");

async function test() {
    console.log("--- Testing Real Diagnosis API ---");
    const symptom = "Me duele mucho la muela del juicio y tengo fiebre";
    console.log(`Sending symptom: "${symptom}"`);

    // This will use the real axios instance from services/api.js
    // which prints logs now.
    const result = await api.getDiagnosis(symptom);

    console.log("\n--- RESULT ---");
    console.log(JSON.stringify(result, null, 2));
}

test();
