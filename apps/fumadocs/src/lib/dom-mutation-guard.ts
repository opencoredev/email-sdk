export const domMutationGuardScript = `
(() => {
  const win = window;

  if (win.__emailSdkDomMutationGuardInstalled || !win.Node) {
    return;
  }

  const nodePrototype = win.Node.prototype;
  const removeChild = nodePrototype.removeChild;
  const insertBefore = nodePrototype.insertBefore;

  if (typeof removeChild !== "function" || typeof insertBefore !== "function") {
    return;
  }

  win.__emailSdkDomMutationGuardInstalled = true;

  nodePrototype.removeChild = function guardedRemoveChild(child) {
    try {
      return removeChild.call(this, child);
    } catch (error) {
      if (error && error.name === "NotFoundError") {
        return child;
      }

      throw error;
    }
  };

  nodePrototype.insertBefore = function guardedInsertBefore(newNode, referenceNode) {
    try {
      return insertBefore.call(this, newNode, referenceNode);
    } catch (error) {
      if (error && error.name === "NotFoundError" && referenceNode && referenceNode.parentNode !== this) {
        return insertBefore.call(this, newNode, null);
      }

      throw error;
    }
  };
})();
`;
