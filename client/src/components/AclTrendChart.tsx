import { memo, useEffect, useRef } from "react";
import uPlot from "uplot";
import type { AclTrendPoint } from "../api";

interface Props {
  data: AclTrendPoint[];
}

export const AclTrendChart = memo(function AclTrendChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const dataRef = useRef<AclTrendPoint[]>(data);
  dataRef.current = data;

  useEffect(() => {
    const node = containerRef.current;
    if (node === null) {return;}

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      if (w === 0 || h === 0) {return;}

      const pts = dataRef.current;
      const aligned: uPlot.AlignedData = [
        pts.map((d) => d.t),
        pts.map((d) => d.acl),
      ];

      if (chartRef.current === null) {
        chartRef.current = new uPlot(
          {
            width: w,
            height: h,
            scales: { x: { time: true } },
            axes: [
              {
                stroke: "#888",
                font: "10px system-ui, sans-serif",
                grid: { stroke: "rgba(128,128,128,0.15)", width: 1 },
                ticks: { show: false },
              },
              {
                label: "ACL (cp)",
                stroke: "#888",
                font: "10px system-ui, sans-serif",
                size: 48,
                grid: { stroke: "rgba(128,128,128,0.15)", width: 1 },
                ticks: { show: false },
              },
            ],
            series: [
              {},
              { stroke: "#f59e0b", width: 2, points: { show: false } },
            ],
            legend: { show: false },
          },
          aligned,
          node,
        );
      } else {
        chartRef.current.setSize({ width: w, height: h });
        chartRef.current.setData(aligned);
      }
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  // Sync data when it changes (e.g. time class switch)
  useEffect(() => {
    if (chartRef.current === null) {return;}
    const aligned: uPlot.AlignedData = [
      data.map((d) => d.t),
      data.map((d) => d.acl),
    ];
    chartRef.current.setData(aligned);
  }, [data]);

  return <div ref={containerRef} className="w-full h-64" />;
});
