import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_staffShell/admin/")({
  component: AdminIndex,
});

function AdminIndex() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/orders", replace: true });
  }, [navigate]);
  return null;
}
