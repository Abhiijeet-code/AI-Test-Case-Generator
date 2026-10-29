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
        "The output must be a JSON object with a single key 'test_cases' containing an array of test case objects. "
        "Example format: {\"test_cases\": [{...}, {...}]}. "
        "Each test case object must have these keys: "
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
            if not api_key:
                raise ValueError("Gemini API key is missing. Please set it in Settings.")
            model_name = model or "gemini-2.5-flash"
            genai.configure(api_key=api_key)
            genai_model = genai.GenerativeModel(model_name, system_instruction=system_prompt)
            response = await genai_model.generate_content_async(
                prompt,
                generation_config=genai.GenerationConfig(response_mime_type="application/json")
            )
            res = json.loads(response.text)
            if isinstance(res, dict) and "test_cases" in res:
                return res["test_cases"]
            if isinstance(res, dict) and len(res.keys()) == 1:
                return list(res.values())[0]
            if isinstance(res, list):
                return res
            return [res]

        elif provider_lower in ("openai", "openrouter"):
            if not api_key:
                raise ValueError(f"{provider} API key is missing. Please set it in Settings.")
            base_url_val = "https://openrouter.ai/api/v1" if provider_lower == "openrouter" else None
            model_name = model or ("openai/gpt-4o-mini" if provider_lower == "openrouter" else "gpt-4o-mini")
            client = openai.AsyncOpenAI(api_key=api_key, base_url=base_url_val)
            completion = await client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            content = completion.choices[0].message.content or "{}"
            res = json.loads(content)
            if isinstance(res, dict) and "test_cases" in res:
                return res["test_cases"]
            if isinstance(res, dict) and len(res.keys()) == 1:
                return list(res.values())[0]
            if isinstance(res, list):
                return res
            return [res]

        elif provider_lower == "claude":
            if not api_key:
                raise ValueError("Claude API key is missing. Please set it in Settings.")
            model_name = model or "claude-3-5-sonnet-20241022"
            async with httpx.AsyncClient() as http_client:
                resp = await http_client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    json={
                        "model": model_name,
                        "max_tokens": 4096,
                        "system": system_prompt,
                        "messages": [{"role": "user", "content": prompt}]
                    },
                    timeout=60.0
                )
                resp.raise_for_status()
                text = resp.json()["content"][0]["text"]
                text = text.strip()
                if text.startswith("```json"): text = text[7:]
                if text.startswith("```"): text = text[3:]
                if text.endswith("```"): text = text[:-3]
                res = json.loads(text.strip())
                if isinstance(res, dict) and "test_cases" in res:
                    return res["test_cases"]
                if isinstance(res, dict) and len(res.keys()) == 1:
                    return list(res.values())[0]
                if isinstance(res, list):
                    return res
                return [res]

        elif provider_lower in ("ollama", "lmstudio"):
            url = base_url or ("http://localhost:11434" if provider_lower == "ollama" else "http://localhost:1234/v1")
            model_name = model or ("llama3" if provider_lower == "ollama" else "local-model")
            endpoint = f"{url.rstrip('/')}/api/chat" if provider_lower == "ollama" else f"{url.rstrip('/')}/chat/completions"
            async with httpx.AsyncClient() as http_client:
                payload = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ]
                }
                if provider_lower == "ollama":
                    payload["stream"] = False
                    payload["format"] = "json"
                resp = await http_client.post(endpoint, json=payload, timeout=120.0)
                resp.raise_for_status()
                data = resp.json()
                content = data["message"]["content"] if "message" in data else data["choices"][0]["message"]["content"]
                content = content.strip()
                if content.startswith("```json"): content = content[7:]
                if content.startswith("```"): content = content[3:]
                if content.endswith("```"): content = content[:-3]
                res = json.loads(content.strip())
                if isinstance(res, dict) and "test_cases" in res:
                    return res["test_cases"]
                if isinstance(res, dict) and len(res.keys()) == 1:
                    return list(res.values())[0]
                if isinstance(res, list):
                    return res
                return [res]

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


async def generate_chat_response(
    prompt: str,
    provider: str,
    config: Dict[str, Any],
    system_prompt: str | None = None
) -> str:
    """
    Generate conversational QA responses, code explanations, and architecture reviews
    without enforcing JSON test cases structure.
    """
    if not system_prompt:
        system_prompt = (
            "You are TestForge AI, an expert Senior QA Automation Architect and Software Testing Specialist. "
            "You provide detailed, insightful, accurate, and comprehensive QA guidance, code explanations, "
            "test architecture advice, debugging help, and test automation solutions. "
            "When asked to explain code, break down the key parts (annotations, setup, lifecycle, test logic, assertions, and teardown) "
            "and suggest testing best practices. "
            "Format your answers with clean GitHub-flavored markdown with code blocks, headings, and bullet points."
        )

    provider_lower = provider.lower()
    resolved = _resolve_config(provider_lower, config)
    api_key = resolved.get("apiKey")
    model = resolved.get("model")
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
                ]
            )
            return completion.choices[0].message.content or ""

        elif provider_lower == "gemini":
            if not api_key:
                raise ValueError("Gemini API key is missing. Please set it in Settings.")
            model_name = model or "gemini-2.5-flash"
            genai.configure(api_key=api_key)
            genai_model = genai.GenerativeModel(model_name, system_instruction=system_prompt)
            response = await genai_model.generate_content_async(prompt)
            return response.text or ""

        elif provider_lower in ("openai", "openrouter"):
            if not api_key:
                raise ValueError(f"{provider} API key is missing. Please set it in Settings.")
            base_url_val = "https://openrouter.ai/api/v1" if provider_lower == "openrouter" else None
            model_name = model or ("openai/gpt-4o-mini" if provider_lower == "openrouter" else "gpt-4o-mini")
            client = openai.AsyncOpenAI(api_key=api_key, base_url=base_url_val)
            completion = await client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ]
            )
            return completion.choices[0].message.content or ""

        elif provider_lower == "claude":
            if not api_key:
                raise ValueError("Claude API key is missing. Please set it in Settings.")
            model_name = model or "claude-3-5-sonnet-20241022"
            async with httpx.AsyncClient() as http_client:
                resp = await http_client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    json={
                        "model": model_name,
                        "max_tokens": 4096,
                        "system": system_prompt,
                        "messages": [{"role": "user", "content": prompt}]
                    },
                    timeout=60.0
                )
                resp.raise_for_status()
                return resp.json()["content"][0]["text"] or ""

        elif provider_lower in ("ollama", "lmstudio"):
            url = base_url or ("http://localhost:11434" if provider_lower == "ollama" else "http://localhost:1234/v1")
            model_name = model or ("llama3" if provider_lower == "ollama" else "local-model")
            endpoint = f"{url.rstrip('/')}/api/chat" if provider_lower == "ollama" else f"{url.rstrip('/')}/chat/completions"
            async with httpx.AsyncClient() as http_client:
                payload = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ]
                }
                if provider_lower == "ollama":
                    payload["stream"] = False
                resp = await http_client.post(endpoint, json=payload, timeout=120.0)
                resp.raise_for_status()
                data = resp.json()
                return data["message"]["content"] if "message" in data else data["choices"][0]["message"]["content"]

        else:
            raise Exception(f"Unsupported LLM provider: {provider}")

    except Exception as e:
        raise Exception(f"Chat completion error: {str(e)}")

