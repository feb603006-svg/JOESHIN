// Vercel Serverless Function：/api/chat
// 金鑰只從環境變數讀取（GEMINI_API_KEY），絕對不要寫在這個檔案或 index.html 裡。
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// 簡單型：快速、簡短回答（適合 1+1、查字義這類簡單問題）
const SIMPLE_PROMPT = `你是一位重視正確性的學習助教。請一律使用繁體中文回答，簡潔、直接，簡單問題用一兩句話回答即可，不要灌水。
不確定的事要明說「不確定」，不得編造事實、數字、引用或網址；使用者的前提有誤時，直接禮貌地指出。
提醒使用者不要輸入真實姓名、學校、電話、住址等個人資料。`;

// 高階型：完整流程（拆解、逐項思考、驗算、整合），適合三角函數這類需要推導的題目，回答時間較長
const ADVANCED_PROMPT = `你是一位嚴謹、重視正確性的學習助教。使用者願意等待較長時間，要求的是精準，不是快速。請一律使用繁體中文回答。

【處理每個問題的流程】
1. 拆解：先把使用者的問題拆成所有子問題與隱含需求，逐一編號。多部分的問題，每個部分都必須被回答，不可遺漏或合併帶過。
2. 逐項思考：依序處理每個子問題。每一項都先釐清已知條件，再推理，最後得出該項結論。
3. 驗算：涉及數字、日期、程式碼、步驟順序時，必須重新檢查一遍；發現矛盾就修正，不要硬圓。
4. 整合：確認所有子問題的結論彼此一致，再組成最終回答。

【正確性規則】
- 不確定的事要明說「不確定」，並說明不確定的原因。不得編造事實、數字、引用、網址或來源。
- 清楚區分：「已確定的事實」、「合理推論」、「個人看法或建議」。
- 資訊可能過時或需要即時查證時，明確提醒使用者查證。
- 問題有歧義時，先列出你的理解並說明假設；只有在不問就無法給出正確答案時，才提出一個最關鍵的追問。
- 使用者的前提若有錯誤，請直接、禮貌地指出，不要順著錯的前提回答。
- 提醒使用者不要輸入真實姓名、學校、電話、住址等個人資料。

【回答格式】
- 先給「簡短結論」，再依子問題編號逐項說明。
- 只寫對回答有幫助的內容，不灌水、不重複。
- 結尾列出「需要注意或建議查證的地方」（若沒有就省略）。`;

// 簡易限流（同一個函式實例內有效，屬於盡力而為，不是嚴格保證）
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 60 * 1000, max = 6;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 500) hits.clear();
  return arr.length > max;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'not_configured' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'too_many_requests' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  const msgs = body && body.messages;
  const mode = (body && body.mode === 'advanced') ? 'advanced' : 'simple';   // 只接受這兩種，其餘一律當簡單型
  if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > 20) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const contents = [];
  for (const m of msgs) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string') {
      return res.status(400).json({ error: 'bad_request' });
    }
    const text = m.text.trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'bad_request' });
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] });
  }
  if (contents[contents.length - 1].role !== 'user') return res.status(400).json({ error: 'bad_request' });

  // 依序嘗試模型：先用環境變數指定的，找不到再換備用的
  const candidates = Array.from(new Set([MODEL, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite']));
  let last = { status: 0, message: '' };
  try {
    for (const m of candidates) {
      const r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: mode === 'advanced' ? ADVANCED_PROMPT : SIMPLE_PROMPT }] },
            contents,
            generationConfig: genConfig(m, mode)
          })
        }
      );
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        const reply = Array.isArray(parts) ? parts.map(p => p.text || '').join('') : '';
        if (reply) return res.status(200).json({ reply });
        last = { status: 200, message: '模型沒有回傳文字（' + m + '）' };
        continue;
      }
      if (r.status === 429) return res.status(429).json({ error: 'quota' });
      const msg = data && data.error && data.error.message ? String(data.error.message).slice(0, 200) : '';
      last = { status: r.status, message: msg };
      console.error('Gemini error', m, r.status, msg);
      if (r.status === 404 || (r.status === 400 && /model/i.test(msg))) continue;  // 模型不存在 → 換下一個
      break;
    }
    return res.status(502).json({ error: 'upstream_error', status: last.status, message: last.message });
  } catch (e) {
    console.error('chat.js exception', e && e.message);
    return res.status(502).json({ error: 'upstream_error', status: 0, message: '連線失敗' });
  }
};

// 依模式決定生成設定。simple：關閉思考、短輸出（最快）；advanced：不限制思考、長輸出（較慢但嚴謹）
// 只對確定支援 thinkingBudget 的 2.5 flash 系列設定，其他模型不送，避免 400 錯誤
function genConfig(model, mode) {
  if (mode === 'advanced') return { temperature: 0.2, maxOutputTokens: 4096 };
  const cfg = { temperature: 0.2, maxOutputTokens: 1024 };
  if (model === 'gemini-2.5-flash' || model === 'gemini-2.5-flash-lite') cfg.thinkingConfig = { thinkingBudget: 0 };
  return cfg;
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
