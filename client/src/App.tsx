import { Routes, Route } from "react-router";
import { AppShell } from "./components/AppShell";
import { Home } from "./pages/Home";
import { Analysis } from "./pages/Analysis";
import { Stats } from "./pages/Stats";
import { Drill } from "./pages/Drill";
import { Study } from "./pages/Study";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/analysis/:gameId" element={<Analysis />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/drill" element={<Drill />} />
        <Route path="/study" element={<Study />} />
      </Route>
    </Routes>
  );
}
