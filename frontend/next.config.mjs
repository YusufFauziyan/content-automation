/** @type {import('next').NextConfig} */
const nextConfig = {
  // Media is read from the backend's output directory at request time, so it
  // never gets copied into the build.
  experimental: { serverActions: { bodySizeLimit: '12mb' } },

  // `next dev` and `next build` write to the same directory and overwrite each
  // other. Setting this lets a production build be made and served alongside a
  // running dev server instead of destroying it:
  //   NEXT_DIST_DIR=.next-prod pnpm build && NEXT_DIST_DIR=.next-prod pnpm start
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};
export default nextConfig;
