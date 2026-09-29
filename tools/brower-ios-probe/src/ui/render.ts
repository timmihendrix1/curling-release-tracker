// The DOM renderer.
//
// Plain TypeScript against the document, deliberately: adding a second application
// framework to a throwaway single-screen instrument would add a dependency graph, a
// build step and a class of bugs that the experiment gains nothing from.
//
// Everything user-visible comes from the view model. This file decides only where text
// goes, never whether a control is usable.
import type { ProbeActionId, ProbeViewModel } from "./viewModel";

export type ProbeRenderHandlers = {
  onAction(id: ProbeActionId): void;
};

function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title: string): HTMLElement {
  const node = element("section", "panel");
  node.appendChild(element("h2", "panel-title", title));
  return node;
}

export function renderProbe(
  root: HTMLElement,
  model: ProbeViewModel,
  handlers: ProbeRenderHandlers
): void {
  root.replaceChildren();

  const header = element("header", "header");
  header.appendChild(element("h1", "title", model.title));
  header.appendChild(element("p", "identity", model.identity));
  root.appendChild(header);

  const status = section("Status");
  status.appendChild(element("p", "line", model.platformLine));
  status.appendChild(element("p", "line", model.bluetoothLine));
  status.appendChild(element("p", "line", model.connectionLine));
  if (model.failure !== null) {
    status.appendChild(element("p", "line failure", model.failure));
  }
  const notices = element("ul", "notices");
  for (const notice of model.notices) {
    notices.appendChild(element("li", undefined, notice));
  }
  status.appendChild(notices);
  root.appendChild(status);

  const controls = section("Actions");
  const actionList = element("div", "actions");
  for (const action of model.actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action action-${action.emphasis}`;
    button.textContent = action.label;
    button.disabled = !action.enabled;
    button.dataset["actionId"] = action.id;
    if (action.disabledReason !== null) {
      button.title = action.disabledReason;
      button.setAttribute("aria-description", action.disabledReason);
    }
    button.addEventListener("click", () => {
      handlers.onAction(action.id);
    });
    const wrapper = element("div", "action-row");
    wrapper.appendChild(button);
    if (!action.enabled && action.disabledReason !== null) {
      wrapper.appendChild(element("span", "reason", action.disabledReason));
    }
    actionList.appendChild(wrapper);
  }
  controls.appendChild(actionList);
  root.appendChild(controls);

  const discovery = section("Discovered services");
  if (model.discoveryNotice !== null) {
    discovery.appendChild(element("p", "line failure", model.discoveryNotice));
  }
  for (const service of model.services) {
    const card = element("div", "service");
    card.appendChild(element("h3", "service-title", service.title));
    card.appendChild(element("p", "mono", service.uuid));
    card.appendChild(element("p", "line", service.discoveryLabel));
    if (!service.documented) {
      card.appendChild(
        element(
          "p",
          "line",
          "This service is not one the manufacturer document names for this probe."
        )
      );
    }
    for (const characteristic of service.characteristics) {
      const row = element("div", "characteristic");
      row.appendChild(element("p", "characteristic-title", characteristic.title));
      row.appendChild(element("p", "mono", characteristic.uuid));
      row.appendChild(element("p", "line", `Properties: ${characteristic.properties}`));
      card.appendChild(row);
    }
    discovery.appendChild(card);
  }
  root.appendChild(discovery);

  const readsPanel = section("Characteristic reads");
  if (model.reads.length === 0) {
    readsPanel.appendChild(element("p", "line", "No characteristic has been read yet."));
  }
  for (const read of model.reads) {
    const row = element("div", "observation");
    row.appendChild(element("p", "observation-title", read.title));
    row.appendChild(element("p", "mono hex", read.hex));
    row.appendChild(element("p", "meta", read.meta));
    readsPanel.appendChild(row);
  }
  root.appendChild(readsPanel);

  const notificationPanel = section("Athlete Data notifications");
  notificationPanel.appendChild(element("p", "line", model.notificationSummary));
  if (model.listenerNotice !== null) {
    notificationPanel.appendChild(element("p", "line failure", model.listenerNotice));
  }
  if (model.notifications.length === 0) {
    notificationPanel.appendChild(
      element("p", "line", "No notification has been received on this connection.")
    );
  }
  for (const notification of model.notifications) {
    const row = element("div", "observation");
    row.appendChild(element("p", "observation-title", notification.title));
    row.appendChild(element("p", "mono hex", notification.hex));
    row.appendChild(element("p", "meta", notification.meta));
    notificationPanel.appendChild(row);
  }
  root.appendChild(notificationPanel);

  const logPanel = section("Observation log");
  logPanel.appendChild(element("p", "line", model.logSummary));
  if (model.exportLine !== null) {
    logPanel.appendChild(element("p", "line", model.exportLine));
  }
  root.appendChild(logPanel);
}
