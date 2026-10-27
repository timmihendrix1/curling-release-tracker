import { createInstallationTransferSourceHelper } from "./sourceHelper";

const button = document.getElementById("inspect"), status = document.getElementById("status");
if (!(button instanceof HTMLButtonElement) || !status) throw new Error("Data check surface unavailable");
const helper = createInstallationTransferSourceHelper();
let ended = false, busy = false;
function end() {
  if (ended) return;
  ended = true; button!.setAttribute("disabled", "");
  status!.textContent = "The data check has ended. Reopen the helper to check again.";
  document.removeEventListener("visibilitychange", visibility);
  window.removeEventListener("pagehide", end);
  button!.removeEventListener("click", inspect);
  void helper.close();
}
function visibility() { if (document.visibilityState !== "visible") end(); }
function inspect(): void {
  if (ended || busy) return;
  busy = true; button!.setAttribute("disabled", ""); status!.textContent = "Checking existing data…";
  void helper.inspect().then(result => {
    busy = false;
    if (ended) return;
    if (!result.ok) {
      end(); status!.textContent = "The data could not be checked. Existing data has not been changed.";
      return;
    }
    status!.textContent = "Source data observed. No transfer file has been created.";
    button!.removeAttribute("disabled");
  });
}
document.addEventListener("visibilitychange", visibility);
window.addEventListener("pagehide", end);
void helper.whenRevoked.then(code => {
  if (ended) return;
  end();
  if (code !== "closed") status!.textContent = "The data could not be checked. Existing data has not been changed.";
});
visibility();
if (!ended) { button.removeAttribute("disabled"); button.addEventListener("click", inspect); }
