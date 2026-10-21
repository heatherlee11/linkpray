export default async () => {
  const url = Netlify.env.get('SUPABASE_URL') || '';
  const anonKey = Netlify.env.get('SUPABASE_ANON_KEY') || '';
  return Response.json({ url, anonKey }, {
    headers: { 'Cache-Control': 'public, max-age=300' }
  });
};
