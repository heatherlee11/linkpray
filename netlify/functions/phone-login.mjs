export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return Response.json({ error: 'Netlify 환경변수 설정이 필요합니다.' }, { status: 500 });
  try {
    const { phone, password } = await req.json();
    const normalized = String(phone || '').replace(/[^0-9+]/g, '');
    if (!/^\+?[0-9]{9,15}$/.test(normalized) || typeof password !== 'string' || password.length < 1 || password.length > 128)
      return Response.json({ error: '연락처 또는 비밀번호를 확인해 주세요.' }, { status: 400 });
    const lookup = await fetch(`${url}/rest/v1/profiles?phone=eq.${encodeURIComponent(normalized)}&select=email`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` }
    });
    if (!lookup.ok) return Response.json({ error: '로그인에 실패했어요. 이메일로 로그인하거나 다시 시도해 주세요.' }, { status: 401 });
    const rows = await lookup.json();
    if (rows.length !== 1) return Response.json({ error: '로그인에 실패했어요. 이메일로 로그인하거나 다시 시도해 주세요.' }, { status: 401 });
    const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: rows[0].email, password })
    });
    const result = await auth.json();
    if (!auth.ok) return Response.json({ error: '로그인에 실패했어요. 입력 정보를 확인해 주세요.' }, { status: 401 });
    return Response.json({ access_token: result.access_token, refresh_token: result.refresh_token });
  } catch {
    return Response.json({ error: '로그인 요청을 처리하지 못했어요.' }, { status: 400 });
  }
};
