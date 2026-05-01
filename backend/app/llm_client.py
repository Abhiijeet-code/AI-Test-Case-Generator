import json
from typing import Dict, Any, List
from pydantic import BaseModel
import groq
import openai
import google.generativeai as genai
import httpx

def build_system_prompt(template: str) -> str:
    base = (
        "You are an expert QA Engineer. Generate test cases based on the provided requirement context. "
        "Output strictly valid JSON with no markdown block formatting or extra text. "
        "The output must be a JSON array of objects. Each object must have these keys: "
        "'id' (string), 'title' (string), 'type' (string), 'priority' (string), 'preconditions' (string), "
        "'steps' (string, use newline for steps), 'test_data' (string), 'expected_result' (string)."
    )
    if template.lower() == "functional":
        base += " Focus on positive and negative functional test paths."
    elif template.lower() == "edge":
        base += " Focus heavily on boundary values, edge cases, and unexpected inputs."
    elif template.lower() == "security":
        base += " Focus on authentication, authorization, injection flaws, and security concerns."
    return base


def _resolve_config(provider: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalise the config dict regardless of whether the frontend sent a flat
    shape (groqApiKey / groqModel / …) or the nested providers.{provider}.* shape.

    Returns a simple dict: { "apiKey": "...", "model": "...", "baseUrl": "..." }
    """
    p = provider.lower()

    # ── nested shape: config.providers.groq.apiKey  ────────────────────────
    providers = config.get("providers", {}) or {}
    nested = providers.get(p, {}) or {}

    # ── flat shape: config.groqApiKey / config.groqModel  ──────────────────
    flat_key_map = {
        "groq":        ("groqApiKey",      "groqModel",         None),
        "openai":      ("openAiApiKey",    "openAiModel",       None),
        "gemini":      ("geminiApiKey",    "geminiModel",       None),
        "claude":      ("claudeApiKey",    "claudeModel",       None),
        "openrouter":  ("openRouterApiKey","openRouterModel",   None),
        "ollama":      (None,              "ollamaModel",       "ollamaUrl"),
        "lmstudio":    (None,              "lmStudioModel",     "lmStudioUrl"),
    }

    key_field, model_field, url_field = flat_key_map.get(p, (None, None, None))

    api_key  = nested.get("apiKey")  or (config.get(key_field)   if key_field  else None)
    model    = nested.get("model")   or (config.get(model_field) if model_field else None)
    base_url = nested.get("baseUrl") or (config.get(url_field)   if url_field  else None)

    return {"apiKey": api_key, "model": model, "baseUrl": base_url}


async def generate_test_cases(prompt: str, provider: str, config: Dict[str, Any], template: str = "Functional") -> List[Dict[str, Any]]:
    system_prompt = build_system_prompt(template)
    provider_lower = provider.lower()
    resolved = _resolve_config(provider_lower, config)

    api_key  = resolved.get("apiKey")
    model    = resolved.get("model")
    base_url = resolved.get("baseUrl")

    try:
        if provider_lower == "groq":
            if not api_key:
                raise ValueError("Groq API key is missing. Please set it in Settings.")
            model = model or "llama-3.3-70b-versatile"
            client = groq.AsyncGroq(api_key=api_key)
            completion = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            content = completion.choices[0].message.content
            # Groq json_object mode requires the prompt to ask for a JSON object, so we might get an object with an array inside
            res = json.loads(content)
            if isinstance(res, dict) and len(res.keys()) == 1:
                return list(res.values())[0]
            if isinstance(res, list):
                return res
            return [res]

        elif provider_lower == "gemini":
            api_key = providers_config.get("gemini", {}).get("apiKey")
            model_name = providers_config.get("gemini", {}).get("model", "gemini-2.5-flash")
            if not api_key: raise Exception("Gemini API key missing")
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(model_name, system_instruction=system_prompt)
            response = await model.generate_content_async(prompt, generation_config=genai.GenerationConfig(response_mime_type="application/json"))
            return json.loads(response.text)

        elif provider_lower == "openrouter":
            api_key = providers_config.get("openrouter", {}).get("apiKey")
            model = providers_config.get("openrouter", {}).get("model", "openai/gpt-4o-mini")
            if not api_key: raise Exception("OpenRouter API key missing")
            client = openai.AsyncOpenAI(api_key=api_key, base_url="https://openrouter.ai/api/v1")
            completion = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ]
            )
            content = completion.choices[0].message.content
            content = content.strip()
            if content.startswith("```json"): content = content[7:]
            if content.startswith("```"): content = content[3:]
            if content.endswith("```"): content = content[:-3]
            return json.loads(content.strip())
            
        elif provider_lower == "ollama":
            base_url = providers_config.get("ollama", {}).get("baseUrl", "http://localhost:11434")
            model = providers_config.get("ollama", {}).get("model", "llama3")
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{base_url.rstrip('/')}/api/chat",
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": prompt}
                        ],
                        "stream": False,
                        "format": "json"
                    },
                    timeout=120.0
                )
                resp.raise_for_status()
                content = resp.json()["message"]["content"]
                return json.loads(content)

        else:
            raise Exception(f"Unsupported LLM provider: {provider}")
            
    except Exception as e:
        raise Exception(f"Failed to generate test cases: {str(e)}")

async def test_llm_connection(provider: str, config: Dict[str, Any]) -> bool:
    try:
        await generate_test_cases("Generate 1 dummy test case for a login page.", provider, config, "Functional")
        return True
    except Exception as e:
        raise Exception(str(e))
