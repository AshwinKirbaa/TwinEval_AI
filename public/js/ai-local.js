/**
 * Local AI client.
 *
 * TwinEval's Node server stores accounts/data, but every computer that
 * performs AI work runs its own local Ollama + Python AI engine. Browser
 * requests therefore go directly to http://127.0.0.1:8000 instead of
 * asking the central Node server to host an AI workload.
 */
window.TwinEvalLocalAI = (() => {
    const defaultUrl = 'http://127.0.0.1:8000';
    // Local-first deployment: AI work always stays on this user's computer.
    // A per-browser override remains available for advanced LAN setups, but a
    // cloud build variable can no longer silently route private documents to
    // a hosted model.
    const configuredUrl = (localStorage.getItem('twineval_ai_url') || defaultUrl).replace(/\/$/, '');

    async function request(path, options = {}) {
        let response;
        try {
            response = await fetch(`${configuredUrl}${path}`, options);
        } catch (error) {
            throw new Error(`Local AI engine is unavailable at ${configuredUrl}. Start the AI engine on this computer. (${error.message})`);
        }

        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { /* handled below */ }

        if (!response.ok) {
            throw new Error((data && data.message) || `AI engine request failed (HTTP ${response.status}).`);
        }
        return data || {};
    }

    async function health() {
        return request('/health');
    }

    async function startJob(path, formData) {
        return request(path, { method: 'POST', body: formData });
    }

    async function getJob(jobId) {
        return request(`/jobs/${encodeURIComponent(jobId)}`);
    }

    return { baseUrl: configuredUrl, request, health, startJob, getJob };
})();
