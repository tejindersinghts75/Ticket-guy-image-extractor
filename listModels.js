import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function listModels() {
  try {
    const response = await client.models.list();
    console.log("Models available for your API key:\n");
    response.data.forEach(model => {
      console.log(model.id);
    });
  } catch (err) {
    console.error("Error fetching models:", err);
  }
}

listModels();
