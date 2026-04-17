import { createFileRoute } from "@tanstack/react-router";
import AuthCompleteScreen from "../components/AuthCompleteScreen";

export const Route = createFileRoute("/auth/plex/complete")({
  component: AuthCompleteScreen,
});
