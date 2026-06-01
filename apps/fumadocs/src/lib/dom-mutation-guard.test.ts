import { describe, expect, test } from "bun:test";

import { domMutationGuardScript } from "./dom-mutation-guard";

class FakeNode {
  parentNode: FakeNode | null = null;
  children: FakeNode[] = [];

  appendChild(child: FakeNode) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }

    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeNode) {
    if (child.parentNode !== this) {
      throw new DOMException(
        "The node to be removed is not a child of this node.",
        "NotFoundError",
      );
    }

    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
    return child;
  }

  insertBefore(newNode: FakeNode, referenceNode: FakeNode | null) {
    if (referenceNode === null) {
      return this.appendChild(newNode);
    }

    if (referenceNode.parentNode !== this) {
      throw new DOMException(
        "The node before which the new node is to be inserted is not a child of this node.",
        "NotFoundError",
      );
    }

    if (newNode.parentNode) {
      newNode.parentNode.removeChild(newNode);
    }

    const referenceIndex = this.children.indexOf(referenceNode);
    newNode.parentNode = this;
    this.children.splice(referenceIndex, 0, newNode);
    return newNode;
  }
}

function installGuard() {
  const fakeWindow = {
    Node: FakeNode,
    __emailSdkDomMutationGuardInstalled: false,
  };

  new Function("window", domMutationGuardScript)(fakeWindow);

  return fakeWindow;
}

describe("dom mutation guard", () => {
  test("ignores removeChild when external DOM mutation already detached the child", () => {
    installGuard();

    const parent = new FakeNode();
    const child = new FakeNode();

    expect(parent.removeChild(child)).toBe(child);
  });

  test("keeps normal removeChild behavior for real children", () => {
    installGuard();

    const parent = new FakeNode();
    const child = new FakeNode();
    parent.appendChild(child);

    expect(parent.removeChild(child)).toBe(child);
    expect(parent.children).toEqual([]);
    expect(child.parentNode).toBeNull();
  });

  test("falls back to append when external DOM mutation moved the reference node", () => {
    installGuard();

    const parent = new FakeNode();
    const otherParent = new FakeNode();
    const referenceNode = new FakeNode();
    const newNode = new FakeNode();

    otherParent.appendChild(referenceNode);

    expect(parent.insertBefore(newNode, referenceNode)).toBe(newNode);
    expect(parent.children).toEqual([newNode]);
    expect(newNode.parentNode).toBe(parent);
  });
});
