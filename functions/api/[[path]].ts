interface Env { API: Fetcher; }
export const onRequest: PagesFunction<Env> = async context => {
  if (!context.env.API) return Response.json({ error: 'The rating service is not configured yet. Saved song estimates are still available.' }, { status: 503 });
  return context.env.API.fetch(context.request);
};
