import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("analysis/:gameId", "routes/analysis.$gameId.tsx"),
  route("api/analyze/:gameId", "routes/api.analyze.$gameId.ts"),
] satisfies RouteConfig;
