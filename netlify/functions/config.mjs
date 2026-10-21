export default async () => {
  const url = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  return Response.json({ url, anonKey }, {
    headers: { 'Cache-Control': 'public, max-age=300' }
  });
};
