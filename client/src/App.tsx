import { Routes, Route } from "react-router";
import { Home } from "./pages/Home";
import { Analysis } from "./pages/Analysis";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/analysis/:gameId" element={<Analysis />} />
    </Routes>
  );
}
