import { Loading } from "../../shell/Loading";

// Shown at once on a navigation here, while the page renders on the server.
export default function MapLoading() {
  return <Loading current="map" />;
}
