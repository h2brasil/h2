import { GoogleGenAI, Type } from "@google/genai";
import { Coordinates, UBS, OptimizationResult, OptimizedStop } from "../types";

const apiKey = process.env.API_KEY;

export const optimizeRoute = async (
  startLocation: Coordinates,
  selectedUBS: UBS[]
): Promise<OptimizationResult> => {
  if (!apiKey) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey });

  // Prepare data for the prompt
  const destinationsPayload = selectedUBS.map((ubs) => ({
    id: ubs.id,
    name: ubs.name,
    lat: ubs.coords.lat,
    lng: ubs.coords.lng,
  }));

  const startPayload = {
    name: "Local Atual do Entregador",
    lat: startLocation.lat,
    lng: startLocation.lng,
  };

  const systemInstruction = `
    Você é um sistema especialista em logística e roteirização para a cidade de Itajaí, SC.
    Sua tarefa é organizar uma lista de Unidades Básicas de Saúde (UBS) na ordem mais eficiente de visitação para um entregador.
    
    Considere:
    1. O ponto de partida do entregador.
    2. A distância geográfica (use a lógica do Caixeiro Viajante / TSP para minimizar a distância total).
    3. A geografia de Itajaí (bairros próximos devem ser agrupados).
    
    Retorne um JSON contendo a lista ordenada de IDs, uma estimativa de distância total e um breve resumo explicativo da rota.
  `;

  const prompt = `
    Ponto de Partida: ${JSON.stringify(startPayload)}
    Destinos: ${JSON.stringify(destinationsPayload)}
    
    Por favor, retorne a ordem otimizada de entrega.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            orderedIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Array of UBS IDs in the optimized order",
            },
            summary: {
              type: Type.STRING,
              description: "Brief textual explanation of the route strategy (max 2 sentences)",
            },
            totalDistanceEst: {
              type: Type.STRING,
              description: "Estimated total distance (e.g., '15 km')",
            },
          },
          required: ["orderedIds", "summary", "totalDistanceEst"],
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    const data = JSON.parse(text);
    
    // Map the IDs back to the full UBS objects
    const orderedStops: OptimizedStop[] = [];
    
    data.orderedIds.forEach((id: string, index: number) => {
      const ubs = selectedUBS.find(u => u.id === id);
      if (ubs) {
        orderedStops.push({
          ...ubs,
          sequence: index + 1,
          status: 'pending',
        });
      }
    });

    return {
      route: orderedStops,
      summary: data.summary,
      totalDistanceEst: data.totalDistanceEst,
    };

  } catch (error) {
    console.error("Error optimizing route:", error);
    throw error;
  }
};