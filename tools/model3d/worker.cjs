var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// worker.ts
var import_promises4 = require("node:fs/promises");

// vendor/daemon/meshy-provider.ts
var import_node_crypto = require("node:crypto");

// vendor/daemon/model3d.ts
var Model3DGenerationError = class extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
};
async function readModel3DResult(response) {
  const maximum = 100 * 1024 * 1024;
  if (!response.body) throw new Model3DGenerationError("Generated model download is empty");
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body.cancel().catch(() => {
    });
    throw new Model3DGenerationError("Generated model is too large", 413);
  }
  const reader = response.body.getReader();
  const chunks2 = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Model3DGenerationError("Generated model is too large", 413);
      chunks2.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
  if (!size) throw new Model3DGenerationError("Generated model download is empty");
  return Buffer.concat(chunks2);
}

// node_modules/property-graph/dist/index.mjs
var EventDispatcher = class {
  _listeners = {};
  addEventListener(type, listener) {
    const listeners = this._listeners;
    if (listeners[type] === void 0) listeners[type] = [];
    if (listeners[type].indexOf(listener) === -1) listeners[type].push(listener);
    return this;
  }
  removeEventListener(type, listener) {
    const listenerArray = this._listeners[type];
    if (listenerArray !== void 0) {
      const index = listenerArray.indexOf(listener);
      if (index !== -1) listenerArray.splice(index, 1);
    }
    return this;
  }
  dispatchEvent(event) {
    const listenerArray = this._listeners[event.type];
    if (listenerArray !== void 0) {
      const array = listenerArray.slice(0);
      for (let i = 0, l = array.length; i < l; i++) array[i].call(this, event);
    }
    return this;
  }
  dispose() {
    for (const key in this._listeners) delete this._listeners[key];
  }
};
var GraphEdge = class {
  _disposed = false;
  _name;
  _parent;
  _child;
  _attributes;
  constructor(_name, _parent, _child, _attributes = {}) {
    this._name = _name;
    this._parent = _parent;
    this._child = _child;
    this._attributes = _attributes;
    if (!_parent.isOnGraph(_child)) throw new Error("Cannot connect disconnected graphs.");
  }
  /** Name (attribute name from parent {@link GraphNode}). */
  getName() {
    return this._name;
  }
  /** Owner node. */
  getParent() {
    return this._parent;
  }
  /** Resource node. */
  getChild() {
    return this._child;
  }
  /**
  * Sets the child node.
  *
  * @internal Only {@link Graph} implementations may safely call this method directly. Use
  * 	{@link Property.swap} or {@link Graph.swapChild} instead.
  */
  setChild(child) {
    this._child = child;
    return this;
  }
  /** Attributes of the graph node relationship. */
  getAttributes() {
    return this._attributes;
  }
  /** Destroys a (currently intact) edge, updating both the graph and the owner. */
  dispose() {
    if (this._disposed) return;
    this._parent._destroyRef(this);
    this._disposed = true;
  }
  /** Whether this link has been destroyed. */
  isDisposed() {
    return this._disposed;
  }
};
var Graph = class extends EventDispatcher {
  _emptySet = /* @__PURE__ */ new Set();
  _edges = /* @__PURE__ */ new Set();
  _parentEdges = /* @__PURE__ */ new Map();
  _childEdges = /* @__PURE__ */ new Map();
  /** Returns a list of all parent->child edges on this graph. */
  listEdges() {
    return Array.from(this._edges);
  }
  /** Returns a list of all edges on the graph having the given node as their child. */
  listParentEdges(node) {
    return Array.from(this._childEdges.get(node) || this._emptySet);
  }
  /** Returns a list of parent nodes for the given child node. */
  listParents(node) {
    const parentSet = /* @__PURE__ */ new Set();
    for (const edge of this.listParentEdges(node)) parentSet.add(edge.getParent());
    return Array.from(parentSet);
  }
  /** Returns a list of all edges on the graph having the given node as their parent. */
  listChildEdges(node) {
    return Array.from(this._parentEdges.get(node) || this._emptySet);
  }
  /** Returns a list of child nodes for the given parent node. */
  listChildren(node) {
    const childSet = /* @__PURE__ */ new Set();
    for (const edge of this.listChildEdges(node)) childSet.add(edge.getChild());
    return Array.from(childSet);
  }
  disconnectParents(node, filter) {
    for (const edge of this.listParentEdges(node)) if (!filter || filter(edge.getParent())) edge.dispose();
    return this;
  }
  /**********************************************************************************************
  * Internal.
  */
  /**
  * Creates a {@link GraphEdge} connecting two {@link GraphNode} instances. Edge is returned
  * for the caller to store.
  * @param a Owner
  * @param b Resource
  * @hidden
  * @internal
  */
  _createEdge(name, a, b, attributes) {
    const edge = new GraphEdge(name, a, b, attributes);
    this._edges.add(edge);
    const parent = edge.getParent();
    if (!this._parentEdges.has(parent)) this._parentEdges.set(parent, /* @__PURE__ */ new Set());
    this._parentEdges.get(parent).add(edge);
    const child = edge.getChild();
    if (!this._childEdges.has(child)) this._childEdges.set(child, /* @__PURE__ */ new Set());
    this._childEdges.get(child).add(edge);
    return edge;
  }
  /**
  * Detaches a {@link GraphEdge} from the {@link Graph}. Before calling this
  * method, ensure that the GraphEdge has first been detached from any
  * associated {@link GraphNode} attributes.
  * @hidden
  * @internal
  */
  _destroyEdge(edge) {
    this._edges.delete(edge);
    this._parentEdges.get(edge.getParent()).delete(edge);
    this._childEdges.get(edge.getChild()).delete(edge);
    return this;
  }
};
var RefList = class {
  list = [];
  constructor(refs) {
    if (refs) for (const ref of refs) this.list.push(ref);
  }
  add(ref) {
    this.list.push(ref);
  }
  remove(ref) {
    const index = this.list.indexOf(ref);
    if (index >= 0) this.list.splice(index, 1);
  }
  removeChild(child) {
    const refs = [];
    for (const ref of this.list) if (ref.getChild() === child) refs.push(ref);
    for (const ref of refs) this.remove(ref);
    return refs;
  }
  listRefsByChild(child) {
    const refs = [];
    for (const ref of this.list) if (ref.getChild() === child) refs.push(ref);
    return refs;
  }
  values() {
    return this.list;
  }
};
var RefSet = class {
  set = /* @__PURE__ */ new Set();
  map = /* @__PURE__ */ new Map();
  constructor(refs) {
    if (refs) for (const ref of refs) this.add(ref);
  }
  add(ref) {
    const child = ref.getChild();
    this.removeChild(child);
    this.set.add(ref);
    this.map.set(child, ref);
  }
  remove(ref) {
    this.set.delete(ref);
    this.map.delete(ref.getChild());
  }
  removeChild(child) {
    const ref = this.map.get(child) || null;
    if (ref) this.remove(ref);
    return ref;
  }
  getRefByChild(child) {
    return this.map.get(child) || null;
  }
  values() {
    return Array.from(this.set);
  }
};
var RefMap = class {
  map = {};
  constructor(map) {
    if (map) Object.assign(this.map, map);
  }
  set(key, child) {
    this.map[key] = child;
  }
  delete(key) {
    delete this.map[key];
  }
  get(key) {
    return this.map[key] || null;
  }
  keys() {
    return Object.keys(this.map);
  }
  values() {
    return Object.values(this.map);
  }
};
var $attributes = Symbol("attributes");
var $immutableKeys = Symbol("immutableKeys");
var GraphNode = class GraphNode2 extends EventDispatcher {
  _disposed = false;
  /**
  * Internal graph used to search and maintain references.
  * @hidden
  */
  graph;
  /**
  * Attributes (literal values and GraphNode references) associated with this instance. For each
  * GraphNode reference, the attributes stores a {@link GraphEdge}. List and Map references are
  * stored as arrays and dictionaries of edges.
  * @internal
  */
  [$attributes];
  /**
  * Attributes included with `getDefaultAttributes` are considered immutable, and cannot be
  * modifed by `.setRef()`, `.copy()`, or other GraphNode methods. Both the edges and the
  * properties will be disposed with the parent GraphNode.
  *
  * Currently, only single-edge references (getRef/setRef) are supported as immutables.
  *
  * @internal
  */
  [$immutableKeys];
  constructor(graph) {
    super();
    this.graph = graph;
    this[$immutableKeys] = /* @__PURE__ */ new Set();
    this[$attributes] = this._createAttributes();
  }
  /**
  * Returns default attributes for the graph node. Subclasses having any attributes (either
  * literal values or references to other graph nodes) must override this method. Literal
  * attributes should be given their default values, if any. References should generally be
  * initialized as empty (Ref → null, RefList → [], RefMap → {}) and then modified by setters.
  *
  * Any single-edge references (setRef) returned by this method will be considered immutable,
  * to be owned by and disposed with the parent node. Multi-edge references (addRef, removeRef,
  * setRefMap) cannot be returned as default attributes.
  */
  getDefaults() {
    return {};
  }
  /**
  * Constructs and returns an object used to store a graph nodes attributes. Compared to the
  * default Attributes interface, this has two distinctions:
  *
  * 1. Slots for GraphNode<T> objects are replaced with slots for GraphEdge<this, GraphNode<T>>
  * 2. GraphNode<T> objects provided as defaults are considered immutable
  *
  * @internal
  */
  _createAttributes() {
    const defaultAttributes = this.getDefaults();
    const attributes = {};
    for (const key in defaultAttributes) {
      const value = defaultAttributes[key];
      if (value instanceof GraphNode2) {
        const ref = this.graph._createEdge(key, this, value);
        this[$immutableKeys].add(key);
        attributes[key] = ref;
      } else attributes[key] = value;
    }
    return attributes;
  }
  /** @internal Returns true if two nodes are on the same {@link Graph}. */
  isOnGraph(other) {
    return this.graph === other.graph;
  }
  /** Returns true if the node has been permanently removed from the graph. */
  isDisposed() {
    return this._disposed;
  }
  /**
  * Removes both inbound references to and outbound references from this object. At the end
  * of the process the object holds no references, and nothing holds references to it. A
  * disposed object is not reusable.
  */
  dispose() {
    if (this._disposed) return;
    this.graph.listChildEdges(this).forEach((edge) => edge.dispose());
    this.graph.disconnectParents(this);
    this._disposed = true;
    this.dispatchEvent({ type: "dispose" });
  }
  /**
  * Removes all inbound references to this object. At the end of the process the object is
  * considered 'detached': it may hold references to child resources, but nothing holds
  * references to it. A detached object may be re-attached.
  */
  detach() {
    this.graph.disconnectParents(this);
    return this;
  }
  /**
  * Transfers this object's references from the old node to the new one. The old node is fully
  * detached from this parent at the end of the process.
  *
  * @hidden
  */
  swap(prevValue, nextValue) {
    for (const attribute in this[$attributes]) {
      const value = this[$attributes][attribute];
      if (value instanceof GraphEdge) {
        const ref = value;
        if (ref.getChild() === prevValue) this.setRef(attribute, nextValue, ref.getAttributes());
      } else if (value instanceof RefList) for (const ref of value.listRefsByChild(prevValue)) {
        const refAttributes = ref.getAttributes();
        this.removeRef(attribute, prevValue);
        this.addRef(attribute, nextValue, refAttributes);
      }
      else if (value instanceof RefSet) {
        const ref = value.getRefByChild(prevValue);
        if (ref) {
          const refAttributes = ref.getAttributes();
          this.removeRef(attribute, prevValue);
          this.addRef(attribute, nextValue, refAttributes);
        }
      } else if (value instanceof RefMap) for (const key of value.keys()) {
        const ref = value.get(key);
        if (ref.getChild() === prevValue) this.setRefMap(attribute, key, nextValue, ref.getAttributes());
      }
    }
    return this;
  }
  /**********************************************************************************************
  * Literal attributes.
  */
  /** @hidden */
  get(attribute) {
    return this[$attributes][attribute];
  }
  /** @hidden */
  set(attribute, value) {
    this[$attributes][attribute] = value;
    return this.dispatchEvent({
      type: "change",
      attribute
    });
  }
  /**********************************************************************************************
  * Ref: 1:1 graph node references.
  */
  /** @hidden */
  getRef(attribute) {
    const ref = this[$attributes][attribute];
    return ref ? ref.getChild() : null;
  }
  /** @hidden */
  setRef(attribute, value, attributes) {
    if (this[$immutableKeys].has(attribute)) throw new Error(`Cannot overwrite immutable attribute, "${attribute}".`);
    const prevRef = this[$attributes][attribute];
    if (prevRef) prevRef.dispose();
    if (!value) return this;
    const ref = this.graph._createEdge(attribute, this, value, attributes);
    this[$attributes][attribute] = ref;
    return this.dispatchEvent({
      type: "change",
      attribute
    });
  }
  /**********************************************************************************************
  * RefList: 1:many graph node references.
  */
  /** @hidden */
  listRefs(attribute) {
    return this.assertRefList(attribute).values().map((ref) => ref.getChild());
  }
  /** @hidden */
  addRef(attribute, value, attributes) {
    const ref = this.graph._createEdge(attribute, this, value, attributes);
    this.assertRefList(attribute).add(ref);
    return this.dispatchEvent({
      type: "change",
      attribute
    });
  }
  /** @hidden */
  removeRef(attribute, value) {
    const refs = this.assertRefList(attribute);
    if (refs instanceof RefList) for (const ref of refs.listRefsByChild(value)) ref.dispose();
    else {
      const ref = refs.getRefByChild(value);
      if (ref) ref.dispose();
    }
    return this;
  }
  /** @hidden */
  assertRefList(attribute) {
    const refs = this[$attributes][attribute];
    if (refs instanceof RefList || refs instanceof RefSet) return refs;
    throw new Error(`Expected RefList or RefSet for attribute "${attribute}"`);
  }
  /**********************************************************************************************
  * RefMap: Named 1:many (map) graph node references.
  */
  /** @hidden */
  listRefMapKeys(attribute) {
    return this.assertRefMap(attribute).keys();
  }
  /** @hidden */
  listRefMapValues(attribute) {
    return this.assertRefMap(attribute).values().map((ref) => ref.getChild());
  }
  /** @hidden */
  getRefMap(attribute, key) {
    const ref = this.assertRefMap(attribute).get(key);
    return ref ? ref.getChild() : null;
  }
  /** @hidden */
  setRefMap(attribute, key, value, metadata) {
    const refMap = this.assertRefMap(attribute);
    const prevRef = refMap.get(key);
    if (prevRef) prevRef.dispose();
    if (!value) return this;
    metadata = Object.assign(metadata || {}, { key });
    const ref = this.graph._createEdge(attribute, this, value, {
      ...metadata,
      key
    });
    refMap.set(key, ref);
    return this.dispatchEvent({
      type: "change",
      attribute,
      key
    });
  }
  /** @hidden */
  assertRefMap(attribute) {
    const map = this[$attributes][attribute];
    if (map instanceof RefMap) return map;
    throw new Error(`Expected RefMap for attribute "${attribute}"`);
  }
  /**********************************************************************************************
  * Events.
  */
  /**
  * Dispatches an event on the GraphNode, and on the associated
  * Graph. Event types on the graph are prefixed, `"node:[type]"`.
  */
  dispatchEvent(event) {
    super.dispatchEvent({
      ...event,
      target: this
    });
    this.graph.dispatchEvent({
      ...event,
      target: this,
      type: `node:${event.type}`
    });
    return this;
  }
  /**********************************************************************************************
  * Internal.
  */
  /** @hidden */
  _destroyRef(ref) {
    const attribute = ref.getName();
    if (this[$attributes][attribute] === ref) {
      this[$attributes][attribute] = null;
      if (this[$immutableKeys].has(attribute)) ref.getChild().dispose();
    } else if (this[$attributes][attribute] instanceof RefList) this[$attributes][attribute].remove(ref);
    else if (this[$attributes][attribute] instanceof RefSet) this[$attributes][attribute].remove(ref);
    else if (this[$attributes][attribute] instanceof RefMap) {
      const refMap = this[$attributes][attribute];
      for (const key of refMap.keys()) if (refMap.get(key) === ref) refMap.delete(key);
    } else return;
    this.graph._destroyEdge(ref);
    this.dispatchEvent({
      type: "change",
      attribute
    });
  }
};

// node_modules/@gltf-transform/core/dist/index.js
var VERSION = `v4.5.1`;
var GLB_BUFFER = "@glb.bin";
var PropertyType = /* @__PURE__ */ (function(PropertyType2) {
  PropertyType2["ACCESSOR"] = "Accessor";
  PropertyType2["ANIMATION"] = "Animation";
  PropertyType2["ANIMATION_CHANNEL"] = "AnimationChannel";
  PropertyType2["ANIMATION_SAMPLER"] = "AnimationSampler";
  PropertyType2["BUFFER"] = "Buffer";
  PropertyType2["CAMERA"] = "Camera";
  PropertyType2["MATERIAL"] = "Material";
  PropertyType2["MESH"] = "Mesh";
  PropertyType2["PRIMITIVE"] = "Primitive";
  PropertyType2["PRIMITIVE_TARGET"] = "PrimitiveTarget";
  PropertyType2["NODE"] = "Node";
  PropertyType2["ROOT"] = "Root";
  PropertyType2["SCENE"] = "Scene";
  PropertyType2["SKIN"] = "Skin";
  PropertyType2["TEXTURE"] = "Texture";
  PropertyType2["TEXTURE_INFO"] = "TextureInfo";
  return PropertyType2;
})({});
var BufferViewUsage$1 = /* @__PURE__ */ (function(BufferViewUsage2) {
  BufferViewUsage2["ARRAY_BUFFER"] = "ARRAY_BUFFER";
  BufferViewUsage2["ELEMENT_ARRAY_BUFFER"] = "ELEMENT_ARRAY_BUFFER";
  BufferViewUsage2["INVERSE_BIND_MATRICES"] = "INVERSE_BIND_MATRICES";
  BufferViewUsage2["OTHER"] = "OTHER";
  BufferViewUsage2["SPARSE"] = "SPARSE";
  return BufferViewUsage2;
})({});
var TextureChannel = /* @__PURE__ */ (function(TextureChannel2) {
  TextureChannel2[TextureChannel2["R"] = 4096] = "R";
  TextureChannel2[TextureChannel2["G"] = 256] = "G";
  TextureChannel2[TextureChannel2["B"] = 16] = "B";
  TextureChannel2[TextureChannel2["A"] = 1] = "A";
  return TextureChannel2;
})({});
var UnsupportedArray = class extends Float32Array {
  constructor() {
    super();
    throw new Error("Unsupported typed array instantiation.");
  }
};
var ComponentTypeToTypedArray = {
  "5120": Int8Array,
  "5121": Uint8Array,
  "5122": Int16Array,
  "5123": Uint16Array,
  "5125": Uint32Array,
  "5131": typeof Float16Array !== "undefined" ? Float16Array : UnsupportedArray,
  "5126": Float32Array,
  "5130": Float64Array
};
var BufferUtils = class {
  /** Creates a byte array from a Data URI. */
  static createBufferFromDataURI(dataURI) {
    if (typeof Buffer === "undefined") {
      const byteString = atob(dataURI.split(",")[1]);
      const ia = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      return ia;
    } else {
      const data = dataURI.split(",")[1];
      const isBase64 = dataURI.indexOf("base64") >= 0;
      return Buffer.from(data, isBase64 ? "base64" : "utf8");
    }
  }
  /** Encodes text to a byte array. */
  static encodeText(text) {
    return new TextEncoder().encode(text);
  }
  /** Decodes a byte array to text. */
  static decodeText(array) {
    return new TextDecoder().decode(array);
  }
  /**
  * Concatenates N byte arrays.
  */
  static concat(arrays) {
    let totalByteLength = 0;
    for (const array of arrays) totalByteLength += array.byteLength;
    const result = new Uint8Array(totalByteLength);
    let byteOffset = 0;
    for (const array of arrays) {
      result.set(array, byteOffset);
      byteOffset += array.byteLength;
    }
    return result;
  }
  /**
  * Pads a Uint8Array to the next 4-byte boundary.
  *
  * Reference: [glTF → Data Alignment](https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#data-alignment)
  */
  static pad(srcArray, paddingByte = 0) {
    const paddedLength = this.padNumber(srcArray.byteLength);
    if (paddedLength === srcArray.byteLength) return srcArray;
    const dstArray = new Uint8Array(paddedLength);
    dstArray.set(srcArray);
    if (paddingByte !== 0) for (let i = srcArray.byteLength; i < paddedLength; i++) dstArray[i] = paddingByte;
    return dstArray;
  }
  /** Pads a number to 4-byte boundaries. */
  static padNumber(v) {
    return Math.ceil(v / 4) * 4;
  }
  /** Returns true if given byte array instances are equal. */
  static equals(a, b) {
    if (a === b) return true;
    if (a.byteLength !== b.byteLength) return false;
    let i = a.byteLength;
    while (i--) if (a[i] !== b[i]) return false;
    return true;
  }
  /**
  * Returns a Uint8Array view of a typed array, with the same underlying ArrayBuffer.
  *
  * A shorthand for:
  *
  * ```js
  * const buffer = new Uint8Array(
  * 	array.buffer,
  * 	array.byteOffset + byteOffset,
  * 	Math.min(array.byteLength, byteLength)
  * );
  * ```
  *
  */
  static toView(a, byteOffset = 0, byteLength = Infinity) {
    return new Uint8Array(a.buffer, a.byteOffset + byteOffset, Math.min(a.byteLength, byteLength));
  }
  static assertView(view) {
    if (view && !ArrayBuffer.isView(view)) throw new Error(`Method requires Uint8Array parameter; received "${typeof view}".`);
    return view;
  }
};
var JPEGImageUtils = class {
  match(array) {
    return array.length >= 3 && array[0] === 255 && array[1] === 216 && array[2] === 255;
  }
  getSize(array) {
    let view = new DataView(array.buffer, array.byteOffset + 4);
    let i, next;
    while (view.byteLength) {
      i = view.getUint16(0, false);
      validateJPEGBuffer(view, i);
      next = view.getUint8(i + 1);
      if (next === 192 || next === 193 || next === 194) return [view.getUint16(i + 7, false), view.getUint16(i + 5, false)];
      view = new DataView(array.buffer, view.byteOffset + i + 2);
    }
    throw new TypeError("Invalid JPG, no size found");
  }
  getChannels(_buffer) {
    return 3;
  }
};
var PNGImageUtils = class PNGImageUtils2 {
  static PNG_FRIED_CHUNK_NAME = "CgBI";
  match(array) {
    return array.length >= 8 && array[0] === 137 && array[1] === 80 && array[2] === 78 && array[3] === 71 && array[4] === 13 && array[5] === 10 && array[6] === 26 && array[7] === 10;
  }
  getSize(array) {
    const view = new DataView(array.buffer, array.byteOffset);
    if (BufferUtils.decodeText(array.slice(12, 16)) === PNGImageUtils2.PNG_FRIED_CHUNK_NAME) return [view.getUint32(32, false), view.getUint32(36, false)];
    return [view.getUint32(16, false), view.getUint32(20, false)];
  }
  getChannels(_buffer) {
    return 4;
  }
};
var ImageUtils = class {
  static impls = {
    "image/jpeg": new JPEGImageUtils(),
    "image/png": new PNGImageUtils()
  };
  /** Registers support for a new image format; useful for certain extensions. */
  static registerFormat(mimeType, impl) {
    this.impls[mimeType] = impl;
  }
  /**
  * Returns detected MIME type of the given image buffer. Note that for image
  * formats with support provided by extensions, the extension must be
  * registered with an I/O class before it can be detected by ImageUtils.
  */
  static getMimeType(buffer) {
    for (const mimeType in this.impls) if (this.impls[mimeType].match(buffer)) return mimeType;
    return null;
  }
  /** Returns the dimensions of the image. */
  static getSize(buffer, mimeType) {
    if (!this.impls[mimeType]) return null;
    return this.impls[mimeType].getSize(buffer);
  }
  /**
  * Returns a conservative estimate of the number of channels in the image. For some image
  * formats, the method may return 4 indicating the possibility of an alpha channel, without
  * the ability to guarantee that an alpha channel is present.
  */
  static getChannels(buffer, mimeType) {
    if (!this.impls[mimeType]) return null;
    return this.impls[mimeType].getChannels(buffer);
  }
  /** Returns a conservative estimate of the GPU memory required by this image. */
  static getVRAMByteLength(buffer, mimeType) {
    if (!this.impls[mimeType]) return null;
    if (this.impls[mimeType].getVRAMByteLength) return this.impls[mimeType].getVRAMByteLength(buffer);
    let uncompressedBytes = 0;
    const channels = 4;
    const resolution = this.getSize(buffer, mimeType);
    if (!resolution) return null;
    while (resolution[0] > 1 || resolution[1] > 1) {
      uncompressedBytes += resolution[0] * resolution[1] * channels;
      resolution[0] = Math.max(Math.floor(resolution[0] / 2), 1);
      resolution[1] = Math.max(Math.floor(resolution[1] / 2), 1);
    }
    uncompressedBytes += 4;
    return uncompressedBytes;
  }
  /** Returns the preferred file extension for the given MIME type. */
  static mimeTypeToExtension(mimeType) {
    if (mimeType === "image/jpeg") return "jpg";
    return mimeType.split("/").pop();
  }
  /** Returns the MIME type for the given file extension. */
  static extensionToMimeType(extension) {
    if (extension === "jpg") return "image/jpeg";
    if (!extension) return "";
    return `image/${extension}`;
  }
};
function validateJPEGBuffer(view, i) {
  if (i > view.byteLength) throw new TypeError("Corrupt JPG, exceeded buffer limits");
  if (view.getUint8(i) !== 255) throw new TypeError("Invalid JPG, marker table corrupted");
  return view;
}
var FileUtils = class {
  /**
  * Extracts the basename from a file path, e.g. "folder/model.glb" -> "model".
  * See: {@link HTTPUtils.basename}
  */
  static basename(uri) {
    const fileName = uri.split(/[\\/]/).pop();
    return fileName.substring(0, fileName.lastIndexOf("."));
  }
  /**
  * Extracts the extension from a file path, e.g. "folder/model.glb" -> "glb".
  * See: {@link HTTPUtils.extension}
  */
  static extension(uri) {
    if (uri.startsWith("data:image/")) {
      const mimeType = uri.match(/data:(image\/\w+)/)[1];
      return ImageUtils.mimeTypeToExtension(mimeType);
    } else if (uri.startsWith("data:model/gltf+json")) return "gltf";
    else if (uri.startsWith("data:model/gltf-binary")) return "glb";
    else if (uri.startsWith("data:application/")) return "bin";
    return uri.split(/[\\/]/).pop().split(/[.]/).pop();
  }
};
var ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;
Math.PI / 180;
180 / Math.PI;
function create() {
  var out = new ARRAY_TYPE(3);
  if (ARRAY_TYPE != Float32Array) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return out;
}
function length(a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  return Math.sqrt(x * x + y * y + z * z);
}
function transformMat4(out, a, m) {
  var x = a[0], y = a[1], z = a[2];
  var w = m[3] * x + m[7] * y + m[11] * z + m[15];
  w = w || 1;
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  return out;
}
(function() {
  var vec = create();
  return function(a, stride, offset, count, fn, arg) {
    var i, l;
    if (!stride) stride = 3;
    if (!offset) offset = 0;
    if (count) l = Math.min(count * stride + offset, a.length);
    else l = a.length;
    for (i = offset; i < l; i += stride) {
      vec[0] = a[i];
      vec[1] = a[i + 1];
      vec[2] = a[i + 2];
      fn(vec, vec, arg);
      a[i] = vec[0];
      a[i + 1] = vec[1];
      a[i + 2] = vec[2];
    }
    return a;
  };
})();
function getBounds(node) {
  const resultBounds = createBounds();
  const parents = node.propertyType === "Node" ? [node] : node.listChildren();
  for (const parent of parents) parent.traverse((node2) => {
    const mesh = node2.getMesh();
    if (!mesh) return;
    const meshBounds = getMeshBounds(mesh, node2.getWorldMatrix());
    if (meshBounds.min.every(isFinite) && meshBounds.max.every(isFinite)) {
      expandBounds(meshBounds.min, resultBounds);
      expandBounds(meshBounds.max, resultBounds);
    }
  });
  return resultBounds;
}
function getMeshBounds(mesh, worldMatrix) {
  const meshBounds = createBounds();
  for (const prim of mesh.listPrimitives()) {
    const position = prim.getAttribute("POSITION");
    const indices = prim.getIndices();
    if (!position) continue;
    let localPos = [
      0,
      0,
      0
    ];
    let worldPos = [
      0,
      0,
      0
    ];
    for (let i = 0, il = indices ? indices.getCount() : position.getCount(); i < il; i++) {
      const index = indices ? indices.getScalar(i) : i;
      localPos = position.getElement(index, localPos);
      worldPos = transformMat4(worldPos, localPos, worldMatrix);
      expandBounds(worldPos, meshBounds);
    }
  }
  return meshBounds;
}
function expandBounds(point, target) {
  for (let i = 0; i < 3; i++) {
    target.min[i] = Math.min(point[i], target.min[i]);
    target.max[i] = Math.max(point[i], target.max[i]);
  }
}
function createBounds() {
  return {
    min: [
      Infinity,
      Infinity,
      Infinity
    ],
    max: [
      -Infinity,
      -Infinity,
      -Infinity
    ]
  };
}
var NULL_DOMAIN = "https://null.example";
var HTTPUtils = class {
  static DEFAULT_INIT = {};
  static PROTOCOL_REGEXP = /^[a-zA-Z]+:\/\//;
  static dirname(path2) {
    const index = path2.lastIndexOf("/");
    if (index === -1) return "./";
    return path2.substring(0, index + 1);
  }
  /**
  * Extracts the basename from a URL, e.g. "folder/model.glb" -> "model".
  * See: {@link FileUtils.basename}
  */
  static basename(uri) {
    return FileUtils.basename(new URL(uri, NULL_DOMAIN).pathname);
  }
  /**
  * Extracts the extension from a URL, e.g. "folder/model.glb" -> "glb".
  * See: {@link FileUtils.extension}
  */
  static extension(uri) {
    return FileUtils.extension(new URL(uri, NULL_DOMAIN).pathname);
  }
  static resolve(base, path2) {
    if (!this.isRelativePath(path2)) return path2;
    const stack = base.split("/");
    const parts = path2.split("/");
    stack.pop();
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === ".") continue;
      if (parts[i] === "..") stack.pop();
      else stack.push(parts[i]);
    }
    return stack.join("/");
  }
  /**
  * Returns true for URLs containing a protocol, and false for both
  * absolute and relative paths.
  */
  static isAbsoluteURL(path2) {
    return this.PROTOCOL_REGEXP.test(path2);
  }
  /**
  * Returns true for paths that are declared relative to some unknown base
  * path. For example, "foo/bar/" is relative both "/foo/bar/" is not.
  */
  static isRelativePath(path2) {
    return !/^(?:[a-zA-Z]+:)?\//.test(path2);
  }
};
function isObject(o) {
  return Object.prototype.toString.call(o) === "[object Object]";
}
function isPlainObject(o) {
  if (isObject(o) === false) return false;
  const ctor = o.constructor;
  if (ctor === void 0) return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false) return false;
  if (Object.hasOwn(prot, "isPrototypeOf") === false) return false;
  return true;
}
var Verbosity = /* @__PURE__ */ (function(Verbosity2) {
  Verbosity2[Verbosity2["SILENT"] = 4] = "SILENT";
  Verbosity2[Verbosity2["ERROR"] = 3] = "ERROR";
  Verbosity2[Verbosity2["WARN"] = 2] = "WARN";
  Verbosity2[Verbosity2["INFO"] = 1] = "INFO";
  Verbosity2[Verbosity2["DEBUG"] = 0] = "DEBUG";
  return Verbosity2;
})({});
var Logger = class Logger2 {
  verbosity;
  /** Logger verbosity thresholds. */
  static Verbosity = Verbosity;
  /** Default logger instance. */
  static DEFAULT_INSTANCE = new Logger2(1);
  /** Constructs a new Logger instance. */
  constructor(verbosity) {
    this.verbosity = verbosity;
  }
  /** Logs an event at level {@link Logger.Verbosity.DEBUG}. */
  debug(text) {
    if (this.verbosity <= 0) console.debug(text);
  }
  /** Logs an event at level {@link Logger.Verbosity.INFO}. */
  info(text) {
    if (this.verbosity <= 1) console.info(text);
  }
  /** Logs an event at level {@link Logger.Verbosity.WARN}. */
  warn(text) {
    if (this.verbosity <= 2) console.warn(text);
  }
  /** Logs an event at level {@link Logger.Verbosity.ERROR}. */
  error(text) {
    if (this.verbosity <= 3) console.error(text);
  }
};
function determinant(a) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  var b0 = a00 * a11 - a01 * a10;
  var b1 = a00 * a12 - a02 * a10;
  var b2 = a01 * a12 - a02 * a11;
  var b3 = a20 * a31 - a21 * a30;
  var b4 = a20 * a32 - a22 * a30;
  var b5 = a21 * a32 - a22 * a31;
  var b6 = a00 * b5 - a01 * b4 + a02 * b3;
  var b7 = a10 * b5 - a11 * b4 + a12 * b3;
  var b8 = a20 * b2 - a21 * b1 + a22 * b0;
  var b9 = a30 * b2 - a31 * b1 + a32 * b0;
  return a13 * b6 - a03 * b7 + a33 * b8 - a23 * b9;
}
function multiply(out, a, b) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[4];
  b1 = b[5];
  b2 = b[6];
  b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[8];
  b1 = b[9];
  b2 = b[10];
  b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[12];
  b1 = b[13];
  b2 = b[14];
  b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}
function getScaling(out, mat) {
  var m11 = mat[0];
  var m12 = mat[1];
  var m13 = mat[2];
  var m21 = mat[4];
  var m22 = mat[5];
  var m23 = mat[6];
  var m31 = mat[8];
  var m32 = mat[9];
  var m33 = mat[10];
  out[0] = Math.sqrt(m11 * m11 + m12 * m12 + m13 * m13);
  out[1] = Math.sqrt(m21 * m21 + m22 * m22 + m23 * m23);
  out[2] = Math.sqrt(m31 * m31 + m32 * m32 + m33 * m33);
  return out;
}
function getRotation(out, mat) {
  var scaling = new ARRAY_TYPE(3);
  getScaling(scaling, mat);
  var is1 = 1 / scaling[0];
  var is2 = 1 / scaling[1];
  var is3 = 1 / scaling[2];
  var sm11 = mat[0] * is1;
  var sm12 = mat[1] * is2;
  var sm13 = mat[2] * is3;
  var sm21 = mat[4] * is1;
  var sm22 = mat[5] * is2;
  var sm23 = mat[6] * is3;
  var sm31 = mat[8] * is1;
  var sm32 = mat[9] * is2;
  var sm33 = mat[10] * is3;
  var trace = sm11 + sm22 + sm33;
  var S = 0;
  if (trace > 0) {
    S = Math.sqrt(trace + 1) * 2;
    out[3] = 0.25 * S;
    out[0] = (sm23 - sm32) / S;
    out[1] = (sm31 - sm13) / S;
    out[2] = (sm12 - sm21) / S;
  } else if (sm11 > sm22 && sm11 > sm33) {
    S = Math.sqrt(1 + sm11 - sm22 - sm33) * 2;
    out[3] = (sm23 - sm32) / S;
    out[0] = 0.25 * S;
    out[1] = (sm12 + sm21) / S;
    out[2] = (sm31 + sm13) / S;
  } else if (sm22 > sm33) {
    S = Math.sqrt(1 + sm22 - sm11 - sm33) * 2;
    out[3] = (sm31 - sm13) / S;
    out[0] = (sm12 + sm21) / S;
    out[1] = 0.25 * S;
    out[2] = (sm23 + sm32) / S;
  } else {
    S = Math.sqrt(1 + sm33 - sm11 - sm22) * 2;
    out[3] = (sm12 - sm21) / S;
    out[0] = (sm31 + sm13) / S;
    out[1] = (sm23 + sm32) / S;
    out[2] = 0.25 * S;
  }
  return out;
}
var MathUtils = class MathUtils2 {
  static identity(v) {
    return v;
  }
  static eq(a, b, tolerance = 1e-5) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tolerance) return false;
    return true;
  }
  static clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }
  static decodeNormalizedInt(i, componentType) {
    switch (componentType) {
      case 5126:
        return i;
      case 5123:
        return i / 65535;
      case 5121:
        return i / 255;
      case 5122:
        return Math.max(i / 32767, -1);
      case 5120:
        return Math.max(i / 127, -1);
      default:
        throw new Error("Invalid component type.");
    }
  }
  static encodeNormalizedInt(f, componentType) {
    switch (componentType) {
      case 5126:
        return f;
      case 5123:
        return Math.round(MathUtils2.clamp(f, 0, 1) * 65535);
      case 5121:
        return Math.round(MathUtils2.clamp(f, 0, 1) * 255);
      case 5122:
        return Math.round(MathUtils2.clamp(f, -1, 1) * 32767);
      case 5120:
        return Math.round(MathUtils2.clamp(f, -1, 1) * 127);
      default:
        throw new Error("Invalid component type.");
    }
  }
  /**
  * Decompose a mat4 to TRS properties.
  *
  * Equivalent to the Matrix4 decompose() method in three.js, and intentionally not using the
  * gl-matrix version. See: https://github.com/toji/gl-matrix/issues/408
  *
  * @param srcMat Matrix element, to be decomposed to TRS properties.
  * @param dstTranslation Translation element, to be overwritten.
  * @param dstRotation Rotation element, to be overwritten.
  * @param dstScale Scale element, to be overwritten.
  */
  static decompose(srcMat, dstTranslation, dstRotation, dstScale) {
    let sx = length([
      srcMat[0],
      srcMat[1],
      srcMat[2]
    ]);
    const sy = length([
      srcMat[4],
      srcMat[5],
      srcMat[6]
    ]);
    const sz = length([
      srcMat[8],
      srcMat[9],
      srcMat[10]
    ]);
    if (determinant(srcMat) < 0) sx = -sx;
    dstTranslation[0] = srcMat[12];
    dstTranslation[1] = srcMat[13];
    dstTranslation[2] = srcMat[14];
    const _m1 = srcMat.slice();
    const invSX = 1 / sx;
    const invSY = 1 / sy;
    const invSZ = 1 / sz;
    _m1[0] *= invSX;
    _m1[1] *= invSX;
    _m1[2] *= invSX;
    _m1[4] *= invSY;
    _m1[5] *= invSY;
    _m1[6] *= invSY;
    _m1[8] *= invSZ;
    _m1[9] *= invSZ;
    _m1[10] *= invSZ;
    getRotation(dstRotation, _m1);
    dstScale[0] = sx;
    dstScale[1] = sy;
    dstScale[2] = sz;
  }
  /**
  * Compose TRS properties to a mat4.
  *
  * Equivalent to the Matrix4 compose() method in three.js, and intentionally not using the
  * gl-matrix version. See: https://github.com/toji/gl-matrix/issues/408
  *
  * @param srcTranslation Translation element of matrix.
  * @param srcRotation Rotation element of matrix.
  * @param srcScale Scale element of matrix.
  * @param dstMat Matrix element, to be modified and returned.
  * @returns dstMat, overwritten to mat4 equivalent of given TRS properties.
  */
  static compose(srcTranslation, srcRotation, srcScale, dstMat) {
    const te = dstMat;
    const x = srcRotation[0], y = srcRotation[1], z = srcRotation[2], w = srcRotation[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = srcScale[0], sy = srcScale[1], sz = srcScale[2];
    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;
    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;
    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;
    te[12] = srcTranslation[0];
    te[13] = srcTranslation[1];
    te[14] = srcTranslation[2];
    te[15] = 1;
    return te;
  }
};
function equalsRef(refA, refB) {
  if (!!refA !== !!refB) return false;
  const a = refA.getChild();
  const b = refB.getChild();
  return a === b || a.equals(b);
}
function equalsRefSet(refSetA, refSetB) {
  if (!!refSetA !== !!refSetB) return false;
  const refValuesA = refSetA.values();
  const refValuesB = refSetB.values();
  if (refValuesA.length !== refValuesB.length) return false;
  for (let i = 0; i < refValuesA.length; i++) {
    const a = refValuesA[i];
    const b = refValuesB[i];
    if (a.getChild() === b.getChild()) continue;
    if (!a.getChild().equals(b.getChild())) return false;
  }
  return true;
}
function equalsRefMap(refMapA, refMapB) {
  if (!!refMapA !== !!refMapB) return false;
  const keysA = refMapA.keys();
  const keysB = refMapB.keys();
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const refA = refMapA.get(key);
    const refB = refMapB.get(key);
    if (!!refA !== !!refB) return false;
    const a = refA.getChild();
    const b = refB.getChild();
    if (a === b) continue;
    if (!a.equals(b)) return false;
  }
  return true;
}
function equalsArray(a, b) {
  if (a === b) return true;
  if (!!a !== !!b || !a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function equalsObject(_a, _b) {
  if (_a === _b) return true;
  if (!!_a !== !!_b) return false;
  if (!isPlainObject(_a) || !isPlainObject(_b)) return _a === _b;
  const a = _a;
  const b = _b;
  let numKeysA = 0;
  let numKeysB = 0;
  let key;
  for (key in a) numKeysA++;
  for (key in b) numKeysB++;
  if (numKeysA !== numKeysB) return false;
  for (key in a) {
    const valueA = a[key];
    const valueB = b[key];
    if (isArray(valueA) && isArray(valueB)) {
      if (!equalsArray(valueA, valueB)) return false;
    } else if (isPlainObject(valueA) && isPlainObject(valueB)) {
      if (!equalsObject(valueA, valueB)) return false;
    } else if (valueA !== valueB) return false;
  }
  return true;
}
function isArray(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}
var ALPHABET = "23456789abdegjkmnpqrvwxyzABDEGJKMNPQRVWXYZ";
var UNIQUE_RETRIES = 999;
var ID_LENGTH = 6;
var previousIDs = /* @__PURE__ */ new Set();
var generateOne = function() {
  let rtn = "";
  for (let i = 0; i < ID_LENGTH; i++) rtn += ALPHABET.charAt(Math.floor(Math.random() * 42));
  return rtn;
};
var uuid = function() {
  for (let retries = 0; retries < UNIQUE_RETRIES; retries++) {
    const id = generateOne();
    if (!previousIDs.has(id)) {
      previousIDs.add(id);
      return id;
    }
  }
  return "";
};
var COPY_IDENTITY = (t) => t;
var EMPTY_SET = /* @__PURE__ */ new Set();
var Property = class extends GraphNode {
  /** @hidden */
  constructor(graph, name = "") {
    super(graph);
    this[$attributes]["name"] = name;
    this.init();
    this.dispatchEvent({ type: "create" });
  }
  /**
  * Returns the Graph associated with this Property. For internal use.
  * @hidden
  * @experimental
  */
  getGraph() {
    return this.graph;
  }
  /**
  * Returns default attributes for the property. Empty lists and maps should be initialized
  * to empty arrays and objects. Always invoke `super.getDefaults()` and extend the result.
  */
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      name: "",
      extras: {}
    });
  }
  /** @hidden */
  set(attribute, value) {
    if (Array.isArray(value)) value = value.slice();
    return super.set(attribute, value);
  }
  /**********************************************************************************************
  * Name.
  */
  /**
  * Returns the name of this property. While names are not required to be unique, this is
  * encouraged, and non-unique names will be overwritten in some tools. For custom data about
  * a property, prefer to use Extras.
  */
  getName() {
    return this.get("name");
  }
  /**
  * Sets the name of this property. While names are not required to be unique, this is
  * encouraged, and non-unique names will be overwritten in some tools. For custom data about
  * a property, prefer to use Extras.
  */
  setName(name) {
    return this.set("name", name);
  }
  /**********************************************************************************************
  * Extras.
  */
  /**
  * Returns a reference to the Extras object, containing application-specific data for this
  * Property. Extras should be an Object, not a primitive value, for best portability.
  */
  getExtras() {
    return this.get("extras");
  }
  /**
  * Updates the Extras object, containing application-specific data for this Property. Extras
  * should be an Object, not a primitive value, for best portability.
  */
  setExtras(extras) {
    return this.set("extras", extras);
  }
  /**********************************************************************************************
  * Graph state.
  */
  /**
  * Makes a copy of this property, with the same resources (by reference) as the original.
  */
  clone() {
    const PropertyClass = this.constructor;
    return new PropertyClass(this.graph).copy(this, COPY_IDENTITY);
  }
  /**
  * Copies all data from another property to this one. Child properties are copied by reference,
  * unless a 'resolve' function is given to override that.
  * @param other Property to copy references from.
  * @param resolve Function to resolve each Property being transferred. Default is identity.
  */
  copy(other, resolve = COPY_IDENTITY) {
    for (const key in this[$attributes]) {
      const value = this[$attributes][key];
      if (value instanceof GraphEdge) {
        if (!this[$immutableKeys].has(key)) value.dispose();
      } else if (value instanceof RefList || value instanceof RefSet) for (const ref of value.values()) ref.dispose();
      else if (value instanceof RefMap) for (const ref of value.values()) ref.dispose();
    }
    for (const key in other[$attributes]) {
      const thisValue = this[$attributes][key];
      const otherValue = other[$attributes][key];
      if (otherValue instanceof GraphEdge) {
        if (this[$immutableKeys].has(key)) thisValue.getChild().copy(resolve(otherValue.getChild()), resolve);
        else this.setRef(key, resolve(otherValue.getChild()), otherValue.getAttributes());
      } else if (otherValue instanceof RefSet || otherValue instanceof RefList) for (const ref of otherValue.values()) this.addRef(key, resolve(ref.getChild()), ref.getAttributes());
      else if (otherValue instanceof RefMap) for (const subkey of otherValue.keys()) {
        const ref = otherValue.get(subkey);
        this.setRefMap(key, subkey, resolve(ref.getChild()), ref.getAttributes());
      }
      else if (isPlainObject(otherValue)) this[$attributes][key] = JSON.parse(JSON.stringify(otherValue));
      else if (Array.isArray(otherValue) || otherValue instanceof ArrayBuffer || ArrayBuffer.isView(otherValue)) this[$attributes][key] = otherValue.slice();
      else this[$attributes][key] = otherValue;
    }
    return this;
  }
  /**
  * Returns true if two properties are deeply equivalent, recursively comparing the attributes
  * of the properties. Optionally, a 'skip' set may be included, specifying attributes whose
  * values should not be considered in the comparison.
  *
  * Example: Two {@link Primitive Primitives} are equivalent if they have accessors and
  * materials with equivalent content — but not necessarily the same specific accessors
  * and materials.
  */
  equals(other, skip = EMPTY_SET) {
    if (this === other) return true;
    if (this.propertyType !== other.propertyType) return false;
    for (const key in this[$attributes]) {
      if (skip.has(key)) continue;
      const a = this[$attributes][key];
      const b = other[$attributes][key];
      if (a instanceof GraphEdge || b instanceof GraphEdge) {
        if (!equalsRef(a, b)) return false;
      } else if (a instanceof RefSet || b instanceof RefSet || a instanceof RefList || b instanceof RefList) {
        if (!equalsRefSet(a, b)) return false;
      } else if (a instanceof RefMap || b instanceof RefMap) {
        if (!equalsRefMap(a, b)) return false;
      } else if (isPlainObject(a) || isPlainObject(b)) {
        if (!equalsObject(a, b)) return false;
      } else if (isArray(a) || isArray(b)) {
        if (!equalsArray(a, b)) return false;
      } else if (a !== b) return false;
    }
    return true;
  }
  detach() {
    this.graph.disconnectParents(this, (n) => n.propertyType !== "Root");
    return this;
  }
  /**
  * Returns a list of all properties that hold a reference to this property. For example, a
  * material may hold references to various textures, but a texture does not hold references
  * to the materials that use it.
  *
  * It is often necessary to filter the results for a particular type: some resources, like
  * {@link Accessor}s, may be referenced by different types of properties. Most properties
  * include the {@link Root} as a parent, which is usually not of interest.
  *
  * Usage:
  *
  * ```ts
  * const materials = texture
  * 	.listParents()
  * 	.filter((p) => p instanceof Material)
  * ```
  */
  listParents() {
    return this.graph.listParents(this);
  }
};
var ExtensibleProperty = class extends Property {
  getDefaults() {
    return Object.assign(super.getDefaults(), { extensions: new RefMap() });
  }
  /** Returns an {@link ExtensionProperty} attached to this Property, if any. */
  getExtension(name) {
    return this.getRefMap("extensions", name);
  }
  /**
  * Attaches the given {@link ExtensionProperty} to this Property. For a given extension, only
  * one ExtensionProperty may be attached to any one Property at a time.
  */
  setExtension(name, extensionProperty) {
    if (extensionProperty) extensionProperty._validateParent(this);
    return this.setRefMap("extensions", name, extensionProperty);
  }
  /** Lists all {@link ExtensionProperty} instances attached to this Property. */
  listExtensions() {
    return this.listRefMapValues("extensions");
  }
};
var Accessor = class Accessor2 extends ExtensibleProperty {
  /**********************************************************************************************
  * Constants.
  */
  /** Element type contained by the accessor (SCALAR, VEC2, ...). */
  static Type = {
    /** Scalar, having 1 value per element. */
    SCALAR: "SCALAR",
    /** 2-component vector, having 2 components per element. */
    VEC2: "VEC2",
    /** 3-component vector, having 3 components per element. */
    VEC3: "VEC3",
    /** 4-component vector, having 4 components per element. */
    VEC4: "VEC4",
    /** 2x2 matrix, having 4 components per element. */
    MAT2: "MAT2",
    /** 3x3 matrix, having 9 components per element. */
    MAT3: "MAT3",
    /** 4x3 matrix, having 16 components per element. */
    MAT4: "MAT4"
  };
  /** Data type of the values composing each element in the accessor. */
  static ComponentType = {
    /**
    * 1-byte signed integer, stored as
    * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Int8Array Int8Array}.
    */
    BYTE: 5120,
    /**
    * 1-byte unsigned integer, stored as
    * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array Uint8Array}.
    */
    UNSIGNED_BYTE: 5121,
    /**
    * 2-byte signed integer, stored as
    * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Int16Array Int16Array}.
    */
    SHORT: 5122,
    /**
    * 2-byte unsigned integer, stored as
    * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint16Array Uint16Array}.
    */
    UNSIGNED_SHORT: 5123,
    /**
    * 4-byte unsigned integer, stored as
    * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint32Array Uint32Array}.
    */
    UNSIGNED_INT: 5125,
    /**
    * 4-byte floating point number, stored as
    * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Float32Array Float32Array}.
    */
    FLOAT: 5126,
    /**
    * 2-byte floating point number, stored as
    * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Float16Array Float16Array}.
    * Requires {@link KHRAccessorFloat16}.
    */
    FLOAT16: 5131,
    /**
    * 8-byte floating point number, stored as
    * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Float64Array Float64Array}.
    * Requires {@link KHRAccessorFloat64}.
    */
    FLOAT64: 5130
  };
  /**********************************************************************************************
  * Instance.
  */
  init() {
    this.propertyType = "Accessor";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      array: null,
      type: Accessor2.Type.SCALAR,
      componentType: Accessor2.ComponentType.FLOAT,
      normalized: false,
      sparse: false,
      buffer: null
    });
  }
  /**********************************************************************************************
  * Static.
  */
  /** Returns size of a given element type, in components. */
  static getElementSize(type) {
    switch (type) {
      case Accessor2.Type.SCALAR:
        return 1;
      case Accessor2.Type.VEC2:
        return 2;
      case Accessor2.Type.VEC3:
        return 3;
      case Accessor2.Type.VEC4:
        return 4;
      case Accessor2.Type.MAT2:
        return 4;
      case Accessor2.Type.MAT3:
        return 9;
      case Accessor2.Type.MAT4:
        return 16;
      default:
        throw new Error("Unexpected type: " + type);
    }
  }
  /** Returns size of a given component type, in bytes. */
  static getComponentSize(componentType) {
    switch (componentType) {
      case Accessor2.ComponentType.BYTE:
      case Accessor2.ComponentType.UNSIGNED_BYTE:
        return 1;
      case Accessor2.ComponentType.SHORT:
      case Accessor2.ComponentType.UNSIGNED_SHORT:
        return 2;
      case Accessor2.ComponentType.UNSIGNED_INT:
      case Accessor2.ComponentType.FLOAT:
        return 4;
      case Accessor2.ComponentType.FLOAT16:
        return 2;
      case Accessor2.ComponentType.FLOAT64:
        return 8;
      default:
        throw new Error("Unexpected component type: " + componentType);
    }
  }
  /**********************************************************************************************
  * Min/max bounds.
  */
  /**
  * Minimum value of each component in this attribute. Unlike in a final glTF file, values
  * returned by this method will reflect the minimum accounting for {@link .normalized}
  * state.
  */
  getMinNormalized(target) {
    const normalized = this.getNormalized();
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    this.getMin(target);
    if (normalized) for (let j = 0; j < elementSize; j++) target[j] = MathUtils.decodeNormalizedInt(target[j], componentType);
    return target;
  }
  /**
  * Minimum value of each component in this attribute. Values returned by this method do not
  * reflect normalization: use {@link .getMinNormalized} in that case.
  */
  getMin(target) {
    const array = this.getArray();
    const count = this.getCount();
    const elementSize = this.getElementSize();
    for (let j = 0; j < elementSize; j++) target[j] = Infinity;
    for (let i = 0; i < count * elementSize; i += elementSize) for (let j = 0; j < elementSize; j++) {
      const value = array[i + j];
      if (Number.isFinite(value)) target[j] = Math.min(target[j], value);
    }
    return target;
  }
  /**
  * Maximum value of each component in this attribute. Unlike in a final glTF file, values
  * returned by this method will reflect the minimum accounting for {@link .normalized}
  * state.
  */
  getMaxNormalized(target) {
    const normalized = this.getNormalized();
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    this.getMax(target);
    if (normalized) for (let j = 0; j < elementSize; j++) target[j] = MathUtils.decodeNormalizedInt(target[j], componentType);
    return target;
  }
  /**
  * Maximum value of each component in this attribute. Values returned by this method do not
  * reflect normalization: use {@link .getMinNormalized} in that case.
  */
  getMax(target) {
    const array = this.get("array");
    const count = this.getCount();
    const elementSize = this.getElementSize();
    for (let j = 0; j < elementSize; j++) target[j] = -Infinity;
    for (let i = 0; i < count * elementSize; i += elementSize) for (let j = 0; j < elementSize; j++) {
      const value = array[i + j];
      if (Number.isFinite(value)) target[j] = Math.max(target[j], value);
    }
    return target;
  }
  /**********************************************************************************************
  * Layout.
  */
  /**
  * Number of elements in the accessor. An array of length 30, containing 10 `VEC3` elements,
  * will have a count of 10.
  */
  getCount() {
    const array = this.get("array");
    return array ? array.length / this.getElementSize() : 0;
  }
  /** Type of element stored in the accessor. `VEC2`, `VEC3`, etc. */
  getType() {
    return this.get("type");
  }
  /**
  * Sets type of element stored in the accessor. `VEC2`, `VEC3`, etc. Array length must be a
  * multiple of the component size (`VEC2` = 2, `VEC3` = 3, ...) for the selected type.
  */
  setType(type) {
    return this.set("type", type);
  }
  /**
  * Number of components in each element of the accessor. For example, the element size of a
  * `VEC2` accessor is 2. This value is determined automatically based on array length and
  * accessor type, specified with {@link Accessor.setType setType()}.
  */
  getElementSize() {
    return Accessor2.getElementSize(this.get("type"));
  }
  /**
  * Size of each component (a value in the raw array), in bytes. For example, the
  * `componentSize` of data backed by a `float32` array is 4 bytes.
  */
  getComponentSize() {
    return this.get("array").BYTES_PER_ELEMENT;
  }
  /**
  * Component type (float32, uint16, etc.). This value is determined automatically, and can only
  * be modified by replacing the underlying array.
  */
  getComponentType() {
    return this.get("componentType");
  }
  /**********************************************************************************************
  * Normalization.
  */
  /**
  * Specifies whether integer data values should be normalized (true) to [0, 1] (for unsigned
  * types) or [-1, 1] (for signed types), or converted directly (false) when they are accessed.
  * This property is defined only for accessors that contain vertex attributes or animation
  * output data.
  */
  getNormalized() {
    return this.get("normalized");
  }
  /**
  * Specifies whether integer data values should be normalized (true) to [0, 1] (for unsigned
  * types) or [-1, 1] (for signed types), or converted directly (false) when they are accessed.
  * This property is defined only for accessors that contain vertex attributes or animation
  * output data.
  */
  setNormalized(normalized) {
    return this.set("normalized", normalized);
  }
  /**********************************************************************************************
  * Data access.
  */
  /**
  * Returns the scalar element value at the given index. For
  * {@link Accessor.getNormalized normalized} integer accessors, values are
  * decoded and returned in floating-point form.
  */
  getScalar(index) {
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    const array = this.getArray();
    if (this.getNormalized()) return MathUtils.decodeNormalizedInt(array[index * elementSize], componentType);
    return array[index * elementSize];
  }
  /**
  * Assigns the scalar element value at the given index. For
  * {@link Accessor.getNormalized normalized} integer accessors, "value" should be
  * given in floating-point form — it will be integer-encoded before writing
  * to the underlying array.
  */
  setScalar(index, x) {
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    const array = this.getArray();
    if (this.getNormalized()) array[index * elementSize] = MathUtils.encodeNormalizedInt(x, componentType);
    else array[index * elementSize] = x;
    return this;
  }
  /**
  * Returns the vector or matrix element value at the given index. For
  * {@link Accessor.getNormalized normalized} integer accessors, values are
  * decoded and returned in floating-point form.
  *
  * Example:
  *
  * ```javascript
  * import { add } from 'gl-matrix/add';
  *
  * const element = [];
  * const offset = [1, 1, 1];
  *
  * for (let i = 0; i < accessor.getCount(); i++) {
  * 	accessor.getElement(i, element);
  * 	add(element, element, offset);
  * 	accessor.setElement(i, element);
  * }
  * ```
  */
  getElement(index, target) {
    const normalized = this.getNormalized();
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    const array = this.getArray();
    for (let i = 0; i < elementSize; i++) if (normalized) target[i] = MathUtils.decodeNormalizedInt(array[index * elementSize + i], componentType);
    else target[i] = array[index * elementSize + i];
    return target;
  }
  /**
  * Assigns the vector or matrix element value at the given index. For
  * {@link Accessor.getNormalized normalized} integer accessors, "value" should be
  * given in floating-point form — it will be integer-encoded before writing
  * to the underlying array.
  *
  * Example:
  *
  * ```javascript
  * import { add } from 'gl-matrix/add';
  *
  * const element = [];
  * const offset = [1, 1, 1];
  *
  * for (let i = 0; i < accessor.getCount(); i++) {
  * 	accessor.getElement(i, element);
  * 	add(element, element, offset);
  * 	accessor.setElement(i, element);
  * }
  * ```
  */
  setElement(index, value) {
    const normalized = this.getNormalized();
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    const array = this.getArray();
    for (let i = 0; i < elementSize; i++) if (normalized) array[index * elementSize + i] = MathUtils.encodeNormalizedInt(value[i], componentType);
    else array[index * elementSize + i] = value[i];
    return this;
  }
  /**********************************************************************************************
  * Raw data storage.
  */
  /**
  * Specifies whether the accessor should be stored sparsely. When written to a glTF file, sparse
  * accessors store only values that differ from base values. When loaded in glTF Transform (or most
  * runtimes) a sparse accessor can be treated like any other accessor. Currently, glTF Transform always
  * uses zeroes for the base values when writing files.
  * @experimental
  */
  getSparse() {
    return this.get("sparse");
  }
  /**
  * Specifies whether the accessor should be stored sparsely. When written to a glTF file, sparse
  * accessors store only values that differ from base values. When loaded in glTF Transform (or most
  * runtimes) a sparse accessor can be treated like any other accessor. Currently, glTF Transform always
  * uses zeroes for the base values when writing files.
  * @experimental
  */
  setSparse(sparse) {
    return this.set("sparse", sparse);
  }
  /** Returns the {@link Buffer} into which this accessor will be organized. */
  getBuffer() {
    return this.getRef("buffer");
  }
  /** Assigns the {@link Buffer} into which this accessor will be organized. */
  setBuffer(buffer) {
    return this.setRef("buffer", buffer);
  }
  /** Returns the raw typed array underlying this accessor. */
  getArray() {
    return this.get("array");
  }
  /** Assigns the raw typed array underlying this accessor. */
  setArray(array) {
    this.set("componentType", array ? arrayToComponentType(array) : Accessor2.ComponentType.FLOAT);
    this.set("array", array);
    return this;
  }
  /** Returns the total bytelength of this accessor, exclusive of padding. */
  getByteLength() {
    const array = this.get("array");
    return array ? array.byteLength : 0;
  }
};
function arrayToComponentType(array) {
  switch (array.constructor) {
    case Float32Array:
      return Accessor.ComponentType.FLOAT;
    case Uint32Array:
      return Accessor.ComponentType.UNSIGNED_INT;
    case Uint16Array:
      return Accessor.ComponentType.UNSIGNED_SHORT;
    case Uint8Array:
      return Accessor.ComponentType.UNSIGNED_BYTE;
    case Int16Array:
      return Accessor.ComponentType.SHORT;
    case Int8Array:
      return Accessor.ComponentType.BYTE;
    case Float64Array:
      return Accessor.ComponentType.FLOAT64;
  }
  if (typeof Float16Array !== "undefined" && array.constructor === Float16Array) return Accessor.ComponentType.FLOAT16;
  throw new Error("Unknown accessor componentType.");
}
var Animation = class extends ExtensibleProperty {
  init() {
    this.propertyType = "Animation";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      channels: new RefSet(),
      samplers: new RefSet()
    });
  }
  /** Adds an {@link AnimationChannel} to this Animation. */
  addChannel(channel) {
    return this.addRef("channels", channel);
  }
  /** Removes an {@link AnimationChannel} from this Animation. */
  removeChannel(channel) {
    return this.removeRef("channels", channel);
  }
  /** Lists {@link AnimationChannel}s in this Animation. */
  listChannels() {
    return this.listRefs("channels");
  }
  /** Adds an {@link AnimationSampler} to this Animation. */
  addSampler(sampler) {
    return this.addRef("samplers", sampler);
  }
  /** Removes an {@link AnimationSampler} from this Animation. */
  removeSampler(sampler) {
    return this.removeRef("samplers", sampler);
  }
  /** Lists {@link AnimationSampler}s in this Animation. */
  listSamplers() {
    return this.listRefs("samplers");
  }
};
var AnimationChannel = class extends ExtensibleProperty {
  /**********************************************************************************************
  * Constants.
  */
  /** Name of the property to be modified by an animation channel. */
  static TargetPath = {
    /** Channel targets {@link Node.setTranslation}. */
    TRANSLATION: "translation",
    /** Channel targets {@link Node.setRotation}. */
    ROTATION: "rotation",
    /** Channel targets {@link Node.setScale}. */
    SCALE: "scale",
    /** Channel targets {@link Node.setWeights}, affecting {@link PrimitiveTarget} weights. */
    WEIGHTS: "weights"
  };
  /**********************************************************************************************
  * Instance.
  */
  init() {
    this.propertyType = "AnimationChannel";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      targetPath: null,
      targetNode: null,
      sampler: null
    });
  }
  /**********************************************************************************************
  * Properties.
  */
  /**
  * Path (property) animated on the target {@link Node}. Supported values include:
  * `translation`, `rotation`, `scale`, or `weights`.
  */
  getTargetPath() {
    return this.get("targetPath");
  }
  /**
  * Path (property) animated on the target {@link Node}. Supported values include:
  * `translation`, `rotation`, `scale`, or `weights`.
  */
  setTargetPath(targetPath) {
    return this.set("targetPath", targetPath);
  }
  /** Target {@link Node} animated by the channel. */
  getTargetNode() {
    return this.getRef("targetNode");
  }
  /** Target {@link Node} animated by the channel. */
  setTargetNode(targetNode) {
    return this.setRef("targetNode", targetNode);
  }
  /**
  * Keyframe data input/output values for the channel. Must be attached to the same
  * {@link Animation}.
  */
  getSampler() {
    return this.getRef("sampler");
  }
  /**
  * Keyframe data input/output values for the channel. Must be attached to the same
  * {@link Animation}.
  */
  setSampler(sampler) {
    return this.setRef("sampler", sampler);
  }
};
var AnimationSampler = class AnimationSampler2 extends ExtensibleProperty {
  /**********************************************************************************************
  * Constants.
  */
  /** Interpolation method. */
  static Interpolation = {
    /** Animated values are linearly interpolated between keyframes. */
    LINEAR: "LINEAR",
    /** Animated values remain constant from one keyframe until the next keyframe. */
    STEP: "STEP",
    /** Animated values are interpolated according to given cubic spline tangents. */
    CUBICSPLINE: "CUBICSPLINE"
  };
  /**********************************************************************************************
  * Instance.
  */
  init() {
    this.propertyType = "AnimationSampler";
  }
  getDefaultAttributes() {
    return Object.assign(super.getDefaults(), {
      interpolation: AnimationSampler2.Interpolation.LINEAR,
      input: null,
      output: null
    });
  }
  /**********************************************************************************************
  * Static.
  */
  /** Interpolation mode: `STEP`, `LINEAR`, or `CUBICSPLINE`. */
  getInterpolation() {
    return this.get("interpolation");
  }
  /** Interpolation mode: `STEP`, `LINEAR`, or `CUBICSPLINE`. */
  setInterpolation(interpolation) {
    return this.set("interpolation", interpolation);
  }
  /** Times for each keyframe, in seconds. */
  getInput() {
    return this.getRef("input");
  }
  /** Times for each keyframe, in seconds. */
  setInput(input) {
    return this.setRef("input", input, { usage: "OTHER" });
  }
  /**
  * Values for each keyframe. For `CUBICSPLINE` interpolation, output also contains in/out
  * tangents.
  */
  getOutput() {
    return this.getRef("output");
  }
  /**
  * Values for each keyframe. For `CUBICSPLINE` interpolation, output also contains in/out
  * tangents.
  */
  setOutput(output) {
    return this.setRef("output", output, { usage: "OTHER" });
  }
};
var Buffer$1 = class extends ExtensibleProperty {
  init() {
    this.propertyType = "Buffer";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { uri: "" });
  }
  /**
  * Returns the URI (or filename) of this buffer (e.g. 'myBuffer.bin'). URIs are strongly
  * encouraged to be relative paths, rather than absolute. Use of a protocol (like `file://`)
  * is possible for custom applications, but will limit the compatibility of the asset with most
  * tools.
  *
  * Buffers commonly use the extension `.bin`, though this is not required.
  */
  getURI() {
    return this.get("uri");
  }
  /**
  * Sets the URI (or filename) of this buffer (e.g. 'myBuffer.bin'). URIs are strongly
  * encouraged to be relative paths, rather than absolute. Use of a protocol (like `file://`)
  * is possible for custom applications, but will limit the compatibility of the asset with most
  * tools.
  *
  * Buffers commonly use the extension `.bin`, though this is not required.
  */
  setURI(uri) {
    return this.set("uri", uri);
  }
};
var Camera = class Camera2 extends ExtensibleProperty {
  /**********************************************************************************************
  * Constants.
  */
  static Type = {
    /** A perspective camera representing a perspective projection matrix. */
    PERSPECTIVE: "perspective",
    /** An orthographic camera representing an orthographic projection matrix. */
    ORTHOGRAPHIC: "orthographic"
  };
  /**********************************************************************************************
  * Instance.
  */
  init() {
    this.propertyType = "Camera";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      type: Camera2.Type.PERSPECTIVE,
      znear: 0.1,
      zfar: 100,
      aspectRatio: null,
      yfov: Math.PI * 2 * 50 / 360,
      xmag: 1,
      ymag: 1
    });
  }
  /**********************************************************************************************
  * Common.
  */
  /** Specifies if the camera uses a perspective or orthographic projection. */
  getType() {
    return this.get("type");
  }
  /** Specifies if the camera uses a perspective or orthographic projection. */
  setType(type) {
    return this.set("type", type);
  }
  /** Floating-point distance to the near clipping plane. */
  getZNear() {
    return this.get("znear");
  }
  /** Floating-point distance to the near clipping plane. */
  setZNear(znear) {
    return this.set("znear", znear);
  }
  /**
  * Floating-point distance to the far clipping plane. When defined, zfar must be greater than
  * znear. If zfar is undefined, runtime must use infinite projection matrix.
  */
  getZFar() {
    return this.get("zfar");
  }
  /**
  * Floating-point distance to the far clipping plane. When defined, zfar must be greater than
  * znear. If zfar is undefined, runtime must use infinite projection matrix.
  */
  setZFar(zfar) {
    return this.set("zfar", zfar);
  }
  /**********************************************************************************************
  * Perspective.
  */
  /**
  * Floating-point aspect ratio of the field of view. When undefined, the aspect ratio of the
  * canvas is used.
  */
  getAspectRatio() {
    return this.get("aspectRatio");
  }
  /**
  * Floating-point aspect ratio of the field of view. When undefined, the aspect ratio of the
  * canvas is used.
  */
  setAspectRatio(aspectRatio) {
    return this.set("aspectRatio", aspectRatio);
  }
  /** Floating-point vertical field of view in radians. */
  getYFov() {
    return this.get("yfov");
  }
  /** Floating-point vertical field of view in radians. */
  setYFov(yfov) {
    return this.set("yfov", yfov);
  }
  /**********************************************************************************************
  * Orthographic.
  */
  /**
  * Floating-point horizontal magnification of the view, and half the view's width
  * in world units.
  */
  getXMag() {
    return this.get("xmag");
  }
  /**
  * Floating-point horizontal magnification of the view, and half the view's width
  * in world units.
  */
  setXMag(xmag) {
    return this.set("xmag", xmag);
  }
  /**
  * Floating-point vertical magnification of the view, and half the view's height
  * in world units.
  */
  getYMag() {
    return this.get("ymag");
  }
  /**
  * Floating-point vertical magnification of the view, and half the view's height
  * in world units.
  */
  setYMag(ymag) {
    return this.set("ymag", ymag);
  }
};
var ExtensionProperty = class extends Property {
  static EXTENSION_NAME;
  /** @hidden */
  _validateParent(parent) {
    if (!this.parentTypes.includes(parent.propertyType)) throw new Error(`Parent "${parent.propertyType}" invalid for child "${this.propertyType}".`);
  }
};
var TextureInfo = class TextureInfo2 extends ExtensibleProperty {
  /**********************************************************************************************
  * Constants.
  */
  /** UV wrapping mode. Values correspond to WebGL enums. */
  static WrapMode = {
    /** */
    CLAMP_TO_EDGE: 33071,
    /** */
    MIRRORED_REPEAT: 33648,
    /** */
    REPEAT: 10497
  };
  /** Magnification filter. Values correspond to WebGL enums. */
  static MagFilter = {
    /** */
    NEAREST: 9728,
    /** */
    LINEAR: 9729
  };
  /** Minification filter. Values correspond to WebGL enums. */
  static MinFilter = {
    /** */
    NEAREST: 9728,
    /** */
    LINEAR: 9729,
    /** */
    NEAREST_MIPMAP_NEAREST: 9984,
    /** */
    LINEAR_MIPMAP_NEAREST: 9985,
    /** */
    NEAREST_MIPMAP_LINEAR: 9986,
    /** */
    LINEAR_MIPMAP_LINEAR: 9987
  };
  /**********************************************************************************************
  * Instance.
  */
  init() {
    this.propertyType = "TextureInfo";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      texCoord: 0,
      magFilter: null,
      minFilter: null,
      wrapS: TextureInfo2.WrapMode.REPEAT,
      wrapT: TextureInfo2.WrapMode.REPEAT
    });
  }
  /**********************************************************************************************
  * Texture coordinates.
  */
  /** Returns the texture coordinate (UV set) index for the texture. */
  getTexCoord() {
    return this.get("texCoord");
  }
  /** Sets the texture coordinate (UV set) index for the texture. */
  setTexCoord(texCoord) {
    return this.set("texCoord", texCoord);
  }
  /**********************************************************************************************
  * Min/mag filter.
  */
  /** Returns the magnification filter applied to the texture. */
  getMagFilter() {
    return this.get("magFilter");
  }
  /** Sets the magnification filter applied to the texture. */
  setMagFilter(magFilter) {
    return this.set("magFilter", magFilter);
  }
  /** Sets the minification filter applied to the texture. */
  getMinFilter() {
    return this.get("minFilter");
  }
  /** Returns the minification filter applied to the texture. */
  setMinFilter(minFilter) {
    return this.set("minFilter", minFilter);
  }
  /**********************************************************************************************
  * UV wrapping.
  */
  /** Returns the S (U) wrapping mode for UVs used by the texture. */
  getWrapS() {
    return this.get("wrapS");
  }
  /** Sets the S (U) wrapping mode for UVs used by the texture. */
  setWrapS(wrapS) {
    return this.set("wrapS", wrapS);
  }
  /** Returns the T (V) wrapping mode for UVs used by the texture. */
  getWrapT() {
    return this.get("wrapT");
  }
  /** Sets the T (V) wrapping mode for UVs used by the texture. */
  setWrapT(wrapT) {
    return this.set("wrapT", wrapT);
  }
};
var { R, G, B, A } = TextureChannel;
var Material = class Material2 extends ExtensibleProperty {
  /**********************************************************************************************
  * Constants.
  */
  static AlphaMode = {
    /**
    * The alpha value is ignored and the rendered output is fully opaque
    */
    OPAQUE: "OPAQUE",
    /**
    * The rendered output is either fully opaque or fully transparent depending on the alpha
    * value and the specified alpha cutoff value
    */
    MASK: "MASK",
    /**
    * The alpha value is used to composite the source and destination areas. The rendered
    * output is combined with the background using the normal painting operation (i.e. the
    * Porter and Duff over operator)
    */
    BLEND: "BLEND"
  };
  /**********************************************************************************************
  * Instance.
  */
  init() {
    this.propertyType = "Material";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      alphaMode: Material2.AlphaMode.OPAQUE,
      alphaCutoff: 0.5,
      doubleSided: false,
      baseColorFactor: [
        1,
        1,
        1,
        1
      ],
      baseColorTexture: null,
      baseColorTextureInfo: new TextureInfo(this.graph, "baseColorTextureInfo"),
      emissiveFactor: [
        0,
        0,
        0
      ],
      emissiveTexture: null,
      emissiveTextureInfo: new TextureInfo(this.graph, "emissiveTextureInfo"),
      normalScale: 1,
      normalTexture: null,
      normalTextureInfo: new TextureInfo(this.graph, "normalTextureInfo"),
      occlusionStrength: 1,
      occlusionTexture: null,
      occlusionTextureInfo: new TextureInfo(this.graph, "occlusionTextureInfo"),
      roughnessFactor: 1,
      metallicFactor: 1,
      metallicRoughnessTexture: null,
      metallicRoughnessTextureInfo: new TextureInfo(this.graph, "metallicRoughnessTextureInfo")
    });
  }
  /**********************************************************************************************
  * Double-sided / culling.
  */
  /** Returns true when both sides of triangles should be rendered. May impact performance. */
  getDoubleSided() {
    return this.get("doubleSided");
  }
  /** Sets whether to render both sides of triangles. May impact performance. */
  setDoubleSided(doubleSided) {
    return this.set("doubleSided", doubleSided);
  }
  /**********************************************************************************************
  * Alpha.
  */
  /** Returns material alpha, equivalent to baseColorFactor[3]. */
  getAlpha() {
    return this.get("baseColorFactor")[3];
  }
  /** Sets material alpha, equivalent to baseColorFactor[3]. */
  setAlpha(alpha) {
    const baseColorFactor = this.get("baseColorFactor").slice();
    baseColorFactor[3] = alpha;
    return this.set("baseColorFactor", baseColorFactor);
  }
  /**
  * Returns the mode of the material's alpha channels, which are provided by `baseColorFactor`
  * and `baseColorTexture`.
  *
  * - `OPAQUE`: Alpha value is ignored and the rendered output is fully opaque.
  * - `BLEND`: Alpha value is used to determine the transparency each pixel on a surface, and
  * 	the fraction of surface vs. background color in the final result. Alpha blending creates
  *	significant edge cases in realtime renderers, and some care when structuring the model is
  * 	necessary for good results. In particular, transparent geometry should be kept in separate
  * 	meshes or primitives from opaque geometry. The `depthWrite` or `zWrite` settings in engines
  * 	should usually be disabled on transparent materials.
  * - `MASK`: Alpha value is compared against `alphaCutoff` threshold for each pixel on a
  * 	surface, and the pixel is either fully visible or fully discarded based on that cutoff.
  * 	This technique is useful for things like leafs/foliage, grass, fabric meshes, and other
  * 	surfaces where no semitransparency is needed. With a good choice of `alphaCutoff`, surfaces
  * 	that don't require semitransparency can avoid the performance penalties and visual issues
  * 	involved with `BLEND` transparency.
  *
  * Reference:
  * - [glTF → material.alphaMode](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#materialalphamode)
  */
  getAlphaMode() {
    return this.get("alphaMode");
  }
  /** Sets the mode of the material's alpha channels. See {@link Material.getAlphaMode getAlphaMode} for details. */
  setAlphaMode(alphaMode) {
    return this.set("alphaMode", alphaMode);
  }
  /** Returns the visibility threshold; applied only when `.alphaMode='MASK'`. */
  getAlphaCutoff() {
    return this.get("alphaCutoff");
  }
  /** Sets the visibility threshold; applied only when `.alphaMode='MASK'`. */
  setAlphaCutoff(alphaCutoff) {
    return this.set("alphaCutoff", alphaCutoff);
  }
  /**********************************************************************************************
  * Base color.
  */
  /**
  * Base color / albedo factor; Linear-sRGB components.
  * See {@link Material.getBaseColorTexture getBaseColorTexture}.
  */
  getBaseColorFactor() {
    return this.get("baseColorFactor");
  }
  /**
  * Base color / albedo factor; Linear-sRGB components.
  * See {@link Material.getBaseColorTexture getBaseColorTexture}.
  */
  setBaseColorFactor(baseColorFactor) {
    return this.set("baseColorFactor", baseColorFactor);
  }
  /**
  * Base color / albedo. The visible color of a non-metallic surface under constant ambient
  * light would be a linear combination (multiplication) of its vertex colors, base color
  * factor, and base color texture. Lighting, and reflections in metallic or smooth surfaces,
  * also effect the final color. The alpha (`.a`) channel of base color factors and textures
  * will have varying effects, based on the setting of {@link Material.getAlphaMode getAlphaMode}.
  *
  * Reference:
  * - [glTF → material.pbrMetallicRoughness.baseColorFactor](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#pbrmetallicroughnessbasecolorfactor)
  */
  getBaseColorTexture() {
    return this.getRef("baseColorTexture");
  }
  /**
  * Settings affecting the material's use of its base color texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getBaseColorTextureInfo() {
    return this.getRef("baseColorTexture") ? this.getRef("baseColorTextureInfo") : null;
  }
  /** Sets base color / albedo texture. See {@link Material.getBaseColorTexture getBaseColorTexture}. */
  setBaseColorTexture(texture) {
    return this.setRef("baseColorTexture", texture, {
      channels: R | G | B | A,
      isColor: true
    });
  }
  /**********************************************************************************************
  * Emissive.
  */
  /** Emissive color; Linear-sRGB components. See {@link Material.getEmissiveTexture getEmissiveTexture}. */
  getEmissiveFactor() {
    return this.get("emissiveFactor");
  }
  /** Emissive color; Linear-sRGB components. See {@link Material.getEmissiveTexture getEmissiveTexture}. */
  setEmissiveFactor(emissiveFactor) {
    return this.set("emissiveFactor", emissiveFactor);
  }
  /**
  * Emissive texture. Emissive color is added to any base color of the material, after any
  * lighting/shadowing are applied. An emissive color does not inherently "glow", or affect
  * objects around it at all. To create that effect, most viewers must also enable a
  * post-processing effect called "bloom".
  *
  * Reference:
  * - [glTF → material.emissiveTexture](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#materialemissivetexture)
  */
  getEmissiveTexture() {
    return this.getRef("emissiveTexture");
  }
  /**
  * Settings affecting the material's use of its emissive texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getEmissiveTextureInfo() {
    return this.getRef("emissiveTexture") ? this.getRef("emissiveTextureInfo") : null;
  }
  /** Sets emissive texture. See {@link Material.getEmissiveTexture getEmissiveTexture}. */
  setEmissiveTexture(texture) {
    return this.setRef("emissiveTexture", texture, {
      channels: R | G | B,
      isColor: true
    });
  }
  /**********************************************************************************************
  * Normal.
  */
  /** Normal (surface detail) factor; linear multiplier. Affects `.normalTexture`. */
  getNormalScale() {
    return this.get("normalScale");
  }
  /** Normal (surface detail) factor; linear multiplier. Affects `.normalTexture`. */
  setNormalScale(scale) {
    return this.set("normalScale", scale);
  }
  /**
  * Normal (surface detail) texture.
  *
  * A tangent space normal map. The texture contains RGB components. Each texel represents the
  * XYZ components of a normal vector in tangent space. Red [0 to 255] maps to X [-1 to 1].
  * Green [0 to 255] maps to Y [-1 to 1]. Blue [128 to 255] maps to Z [1/255 to 1]. The normal
  * vectors use OpenGL conventions where +X is right and +Y is up. +Z points toward the viewer.
  *
  * Reference:
  * - [glTF → material.normalTexture](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#materialnormaltexture)
  */
  getNormalTexture() {
    return this.getRef("normalTexture");
  }
  /**
  * Settings affecting the material's use of its normal texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getNormalTextureInfo() {
    return this.getRef("normalTexture") ? this.getRef("normalTextureInfo") : null;
  }
  /** Sets normal (surface detail) texture. See {@link Material.getNormalTexture getNormalTexture}. */
  setNormalTexture(texture) {
    return this.setRef("normalTexture", texture, { channels: R | G | B });
  }
  /**********************************************************************************************
  * Occlusion.
  */
  /** (Ambient) Occlusion factor; linear multiplier. Affects `.occlusionTexture`. */
  getOcclusionStrength() {
    return this.get("occlusionStrength");
  }
  /** Sets (ambient) occlusion factor; linear multiplier. Affects `.occlusionTexture`. */
  setOcclusionStrength(strength) {
    return this.set("occlusionStrength", strength);
  }
  /**
  * (Ambient) Occlusion texture, generally used for subtle 'baked' shadowing effects that are
  * independent of an object's position, such as shading in inset areas and corners. Direct
  * lighting is not affected by occlusion, so at least one indirect light source must be present
  * in the scene for occlusion effects to be visible.
  *
  * The occlusion values are sampled from the R channel. Higher values indicate areas that
  * should receive full indirect lighting and lower values indicate no indirect lighting.
  *
  * Reference:
  * - [glTF → material.occlusionTexture](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#materialocclusiontexture)
  */
  getOcclusionTexture() {
    return this.getRef("occlusionTexture");
  }
  /**
  * Settings affecting the material's use of its occlusion texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getOcclusionTextureInfo() {
    return this.getRef("occlusionTexture") ? this.getRef("occlusionTextureInfo") : null;
  }
  /** Sets (ambient) occlusion texture. See {@link Material.getOcclusionTexture getOcclusionTexture}. */
  setOcclusionTexture(texture) {
    return this.setRef("occlusionTexture", texture, { channels: R });
  }
  /**********************************************************************************************
  * Metallic / roughness.
  */
  /**
  * Roughness factor; linear multiplier. Affects roughness channel of
  * `metallicRoughnessTexture`. See {@link Material.getMetallicRoughnessTexture getMetallicRoughnessTexture}.
  */
  getRoughnessFactor() {
    return this.get("roughnessFactor");
  }
  /**
  * Sets roughness factor; linear multiplier. Affects roughness channel of
  * `metallicRoughnessTexture`. See {@link Material.getMetallicRoughnessTexture getMetallicRoughnessTexture}.
  */
  setRoughnessFactor(factor) {
    return this.set("roughnessFactor", factor);
  }
  /**
  * Metallic factor; linear multiplier. Affects roughness channel of
  * `metallicRoughnessTexture`. See {@link Material.getMetallicRoughnessTexture getMetallicRoughnessTexture}.
  */
  getMetallicFactor() {
    return this.get("metallicFactor");
  }
  /**
  * Sets metallic factor; linear multiplier. Affects roughness channel of
  * `metallicRoughnessTexture`. See {@link Material.getMetallicRoughnessTexture getMetallicRoughnessTexture}.
  */
  setMetallicFactor(factor) {
    return this.set("metallicFactor", factor);
  }
  /**
  * Metallic roughness texture. The metalness values are sampled from the B channel. The
  * roughness values are sampled from the G channel. When a material is fully metallic,
  * or nearly so, it may require image-based lighting (i.e. an environment map) or global
  * illumination to appear well-lit.
  *
  * Reference:
  * - [glTF → material.pbrMetallicRoughness.metallicRoughnessTexture](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#pbrmetallicroughnessmetallicroughnesstexture)
  */
  getMetallicRoughnessTexture() {
    return this.getRef("metallicRoughnessTexture");
  }
  /**
  * Settings affecting the material's use of its metallic/roughness texture. If no texture is
  * attached, {@link TextureInfo} is `null`.
  */
  getMetallicRoughnessTextureInfo() {
    return this.getRef("metallicRoughnessTexture") ? this.getRef("metallicRoughnessTextureInfo") : null;
  }
  /**
  * Sets metallic/roughness texture.
  * See {@link Material.getMetallicRoughnessTexture getMetallicRoughnessTexture}.
  */
  setMetallicRoughnessTexture(texture) {
    return this.setRef("metallicRoughnessTexture", texture, { channels: G | B });
  }
};
var Mesh = class extends ExtensibleProperty {
  init() {
    this.propertyType = "Mesh";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      weights: [],
      primitives: new RefSet()
    });
  }
  /** Adds a {@link Primitive} to the mesh's draw call list. */
  addPrimitive(primitive) {
    return this.addRef("primitives", primitive);
  }
  /** Removes a {@link Primitive} from the mesh's draw call list. */
  removePrimitive(primitive) {
    return this.removeRef("primitives", primitive);
  }
  /** Lists {@link Primitive} draw calls of the mesh. */
  listPrimitives() {
    return this.listRefs("primitives");
  }
  /**
  * Initial weights of each {@link PrimitiveTarget} on this mesh. Each {@link Primitive} must
  * have the same number of targets. Most engines only support 4-8 active morph targets at a
  * time.
  */
  getWeights() {
    return this.get("weights");
  }
  /**
  * Initial weights of each {@link PrimitiveTarget} on this mesh. Each {@link Primitive} must
  * have the same number of targets. Most engines only support 4-8 active morph targets at a
  * time.
  */
  setWeights(weights) {
    return this.set("weights", weights);
  }
};
var Node = class extends ExtensibleProperty {
  init() {
    this.propertyType = "Node";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      translation: [
        0,
        0,
        0
      ],
      rotation: [
        0,
        0,
        0,
        1
      ],
      scale: [
        1,
        1,
        1
      ],
      weights: [],
      camera: null,
      mesh: null,
      skin: null,
      children: new RefSet()
    });
  }
  copy(other, resolve = COPY_IDENTITY) {
    if (resolve === COPY_IDENTITY) throw new Error("Node cannot be copied.");
    return super.copy(other, resolve);
  }
  /**********************************************************************************************
  * Local transform.
  */
  /** Returns the translation (position) of this Node in local space. */
  getTranslation() {
    return this.get("translation");
  }
  /** Returns the rotation (quaternion) of this Node in local space. */
  getRotation() {
    return this.get("rotation");
  }
  /** Returns the scale of this Node in local space. */
  getScale() {
    return this.get("scale");
  }
  /** Sets the translation (position) of this Node in local space. */
  setTranslation(translation) {
    return this.set("translation", translation);
  }
  /** Sets the rotation (quaternion) of this Node in local space. */
  setRotation(rotation) {
    return this.set("rotation", rotation);
  }
  /** Sets the scale of this Node in local space. */
  setScale(scale) {
    return this.set("scale", scale);
  }
  /** Returns the local matrix of this Node. */
  getMatrix() {
    return MathUtils.compose(this.get("translation"), this.get("rotation"), this.get("scale"), []);
  }
  /** Sets the local matrix of this Node. Matrix will be decomposed to TRS properties. */
  setMatrix(matrix) {
    const translation = this.get("translation").slice();
    const rotation = this.get("rotation").slice();
    const scale = this.get("scale").slice();
    MathUtils.decompose(matrix, translation, rotation, scale);
    return this.set("translation", translation).set("rotation", rotation).set("scale", scale);
  }
  /**********************************************************************************************
  * World transform.
  */
  /** Returns the translation (position) of this Node in world space. */
  getWorldTranslation() {
    const t = [
      0,
      0,
      0
    ];
    MathUtils.decompose(this.getWorldMatrix(), t, [
      0,
      0,
      0,
      1
    ], [
      1,
      1,
      1
    ]);
    return t;
  }
  /** Returns the rotation (quaternion) of this Node in world space. */
  getWorldRotation() {
    const r = [
      0,
      0,
      0,
      1
    ];
    MathUtils.decompose(this.getWorldMatrix(), [
      0,
      0,
      0
    ], r, [
      1,
      1,
      1
    ]);
    return r;
  }
  /** Returns the scale of this Node in world space. */
  getWorldScale() {
    const s = [
      1,
      1,
      1
    ];
    MathUtils.decompose(this.getWorldMatrix(), [
      0,
      0,
      0
    ], [
      0,
      0,
      0,
      1
    ], s);
    return s;
  }
  /** Returns the world matrix of this Node. */
  getWorldMatrix() {
    const ancestors = [];
    for (let node = this; node != null; node = node.getParentNode()) ancestors.push(node);
    let ancestor;
    const worldMatrix = ancestors.pop().getMatrix();
    while (ancestor = ancestors.pop()) multiply(worldMatrix, worldMatrix, ancestor.getMatrix());
    return worldMatrix;
  }
  /**********************************************************************************************
  * Scene hierarchy.
  */
  /**
  * Adds the given Node as a child of this Node.
  *
  * Requirements:
  *
  * 1. Nodes MAY be root children of multiple {@link Scene Scenes}
  * 2. Nodes MUST NOT be children of >1 Node
  * 3. Nodes MUST NOT be children of both Nodes and {@link Scene Scenes}
  *
  * The `addChild` method enforces these restrictions automatically, and will
  * remove the new child from previous parents where needed. This behavior
  * may change in future major releases of the library.
  */
  addChild(child) {
    const parentNode = child.getParentNode();
    if (parentNode) parentNode.removeChild(child);
    for (const parent of child.listParents()) if (parent.propertyType === "Scene") parent.removeChild(child);
    return this.addRef("children", child);
  }
  /** Removes a Node from this Node's child Node list. */
  removeChild(child) {
    return this.removeRef("children", child);
  }
  /** Lists all child Nodes of this Node. */
  listChildren() {
    return this.listRefs("children");
  }
  /**
  * Returns the Node's unique parent Node within the scene graph. If the
  * Node has no parents, or is a direct child of the {@link Scene}
  * ("root node"), this method returns null.
  *
  * Unrelated to {@link Property.listParents}, which lists all resource
  * references from properties of any type ({@link Skin}, {@link Root}, ...).
  */
  getParentNode() {
    for (const parent of this.listParents()) if (parent.propertyType === "Node") return parent;
    return null;
  }
  /**********************************************************************************************
  * Attachments.
  */
  /** Returns the {@link Mesh}, if any, instantiated at this Node. */
  getMesh() {
    return this.getRef("mesh");
  }
  /**
  * Sets a {@link Mesh} to be instantiated at this Node. A single mesh may be instantiated by
  * multiple Nodes; reuse of this sort is strongly encouraged.
  */
  setMesh(mesh) {
    return this.setRef("mesh", mesh);
  }
  /** Returns the {@link Camera}, if any, instantiated at this Node. */
  getCamera() {
    return this.getRef("camera");
  }
  /** Sets a {@link Camera} to be instantiated at this Node. */
  setCamera(camera) {
    return this.setRef("camera", camera);
  }
  /** Returns the {@link Skin}, if any, instantiated at this Node. */
  getSkin() {
    return this.getRef("skin");
  }
  /** Sets a {@link Skin} to be instantiated at this Node. */
  setSkin(skin) {
    return this.setRef("skin", skin);
  }
  /**
  * Initial weights of each {@link PrimitiveTarget} for the mesh instance at this Node.
  * Most engines only support 4-8 active morph targets at a time.
  */
  getWeights() {
    return this.get("weights");
  }
  /**
  * Initial weights of each {@link PrimitiveTarget} for the mesh instance at this Node.
  * Most engines only support 4-8 active morph targets at a time.
  */
  setWeights(weights) {
    return this.set("weights", weights);
  }
  /**********************************************************************************************
  * Helpers.
  */
  /** Visits this {@link Node} and its descendants, top-down. */
  traverse(fn) {
    fn(this);
    for (const child of this.listChildren()) child.traverse(fn);
    return this;
  }
};
var Primitive = class Primitive2 extends ExtensibleProperty {
  /**********************************************************************************************
  * Constants.
  */
  /** Type of primitives to render. All valid values correspond to WebGL enums. */
  static Mode = {
    /**
    * Each vertex defines a single point primitive.
    * Sequence: {0}, {1}, {2}, ... {i}
    */
    POINTS: 0,
    /**
    * Each consecutive pair of vertices defines a single line primitive.
    * Sequence: {0,1}, {2,3}, {4,5}, ... {i, i+1}
    */
    LINES: 1,
    /**
    * Each vertex is connected to the next, and the last vertex is connected to the first,
    * forming a closed loop of line primitives.
    * Sequence: {0,1}, {1,2}, {2,3}, ... {i, i+1}, {n–1, 0}
    *
    * @deprecated See {@link https://github.com/KhronosGroup/glTF/issues/1883 KhronosGroup/glTF#1883}.
    */
    LINE_LOOP: 2,
    /**
    * Each vertex is connected to the next, forming a contiguous series of line primitives.
    * Sequence: {0,1}, {1,2}, {2,3}, ... {i, i+1}
    */
    LINE_STRIP: 3,
    /**
    * Each consecutive set of three vertices defines a single triangle primitive.
    * Sequence: {0,1,2}, {3,4,5}, {6,7,8}, ... {i, i+1, i+2}
    */
    TRIANGLES: 4,
    /**
    * Each vertex defines one triangle primitive, using the two vertices that follow it.
    * Sequence: {0,1,2}, {1,3,2}, {2,3,4}, ... {i, i+(1+i%2), i+(2–i%2)}
    */
    TRIANGLE_STRIP: 5,
    /**
    * Each consecutive pair of vertices defines a triangle primitive sharing a common vertex at index 0.
    * Sequence: {1,2,0}, {2,3,0}, {3,4,0}, ... {i, i+1, 0}
    *
    * @deprecated See {@link https://github.com/KhronosGroup/glTF/issues/1883 KhronosGroup/glTF#1883}.
    */
    TRIANGLE_FAN: 6
  };
  /**********************************************************************************************
  * Instance.
  */
  init() {
    this.propertyType = "Primitive";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      mode: Primitive2.Mode.TRIANGLES,
      material: null,
      indices: null,
      attributes: new RefMap(),
      targets: new RefSet()
    });
  }
  /**********************************************************************************************
  * Primitive data.
  */
  /** Returns an {@link Accessor} with indices of vertices to be drawn. */
  getIndices() {
    return this.getRef("indices");
  }
  /**
  * Sets an {@link Accessor} with indices of vertices to be drawn. In `TRIANGLES` draw mode,
  * each set of three indices define a triangle. The front face has a counter-clockwise (CCW)
  * winding order.
  */
  setIndices(indices) {
    return this.setRef("indices", indices, { usage: "ELEMENT_ARRAY_BUFFER" });
  }
  /** Returns a vertex attribute as an {@link Accessor}. */
  getAttribute(semantic) {
    return this.getRefMap("attributes", semantic);
  }
  /**
  * Sets a vertex attribute to an {@link Accessor}. All attributes must have the same vertex
  * count.
  */
  setAttribute(semantic, accessor) {
    return this.setRefMap("attributes", semantic, accessor, { usage: "ARRAY_BUFFER" });
  }
  /**
  * Lists all vertex attribute {@link Accessor}s associated with the primitive, excluding any
  * attributes used for morph targets. For example, `[positionAccessor, normalAccessor,
  * uvAccessor]`. Order will be consistent with the order returned by {@link .listSemantics}().
  */
  listAttributes() {
    return this.listRefMapValues("attributes");
  }
  /**
  * Lists all vertex attribute semantics associated with the primitive, excluding any semantics
  * used for morph targets. For example, `['POSITION', 'NORMAL', 'TEXCOORD_0']`. Order will be
  * consistent with the order returned by {@link .listAttributes}().
  */
  listSemantics() {
    return this.listRefMapKeys("attributes");
  }
  /** Returns the material used to render the primitive. */
  getMaterial() {
    return this.getRef("material");
  }
  /** Sets the material used to render the primitive. */
  setMaterial(material) {
    return this.setRef("material", material);
  }
  /**********************************************************************************************
  * Mode.
  */
  /**
  * Returns the GPU draw mode (`TRIANGLES`, `LINES`, `POINTS`...) as a WebGL enum value.
  *
  * Reference:
  * - [glTF → `primitive.mode`](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#primitivemode)
  */
  getMode() {
    return this.get("mode");
  }
  /**
  * Sets the GPU draw mode (`TRIANGLES`, `LINES`, `POINTS`...) as a WebGL enum value.
  *
  * Reference:
  * - [glTF → `primitive.mode`](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#primitivemode)
  */
  setMode(mode) {
    return this.set("mode", mode);
  }
  /**********************************************************************************************
  * Morph targets.
  */
  /** Lists all morph targets associated with the primitive. */
  listTargets() {
    return this.listRefs("targets");
  }
  /**
  * Adds a morph target to the primitive. All primitives in the same mesh must have the same
  * number of targets.
  */
  addTarget(target) {
    return this.addRef("targets", target);
  }
  /**
  * Removes a morph target from the primitive. All primitives in the same mesh must have the same
  * number of targets.
  */
  removeTarget(target) {
    return this.removeRef("targets", target);
  }
};
var PrimitiveTarget = class extends Property {
  init() {
    this.propertyType = "PrimitiveTarget";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { attributes: new RefMap() });
  }
  /** Returns a morph target vertex attribute as an {@link Accessor}. */
  getAttribute(semantic) {
    return this.getRefMap("attributes", semantic);
  }
  /**
  * Sets a morph target vertex attribute to an {@link Accessor}.
  */
  setAttribute(semantic, accessor) {
    return this.setRefMap("attributes", semantic, accessor, { usage: "ARRAY_BUFFER" });
  }
  /**
  * Lists all morph target vertex attribute {@link Accessor}s associated. Order will be
  * consistent with the order returned by {@link .listSemantics}().
  */
  listAttributes() {
    return this.listRefMapValues("attributes");
  }
  /**
  * Lists all morph target vertex attribute semantics associated. Order will be
  * consistent with the order returned by {@link .listAttributes}().
  */
  listSemantics() {
    return this.listRefMapKeys("attributes");
  }
};
var Scene = class extends ExtensibleProperty {
  init() {
    this.propertyType = "Scene";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { children: new RefSet() });
  }
  copy(other, resolve = COPY_IDENTITY) {
    if (resolve === COPY_IDENTITY) throw new Error("Scene cannot be copied.");
    return super.copy(other, resolve);
  }
  /**
  * Adds a {@link Node} to the Scene.
  *
  * Requirements:
  *
  * 1. Nodes MAY be root children of multiple {@link Scene Scenes}
  * 2. Nodes MUST NOT be children of >1 Node
  * 3. Nodes MUST NOT be children of both Nodes and {@link Scene Scenes}
  *
  * The `addChild` method enforces these restrictions automatically, and will
  * remove the new child from previous parents where needed. This behavior
  * may change in future major releases of the library.
  */
  addChild(node) {
    const parentNode = node.getParentNode();
    if (parentNode) parentNode.removeChild(node);
    return this.addRef("children", node);
  }
  /** Removes a {@link Node} from the Scene. */
  removeChild(node) {
    return this.removeRef("children", node);
  }
  /**
  * Lists all direct child {@link Node Nodes} in the Scene. Indirect
  * descendants (children of children) are not returned, but may be
  * reached recursively or with {@link Scene.traverse} instead.
  */
  listChildren() {
    return this.listRefs("children");
  }
  /** Visits each {@link Node} in the Scene, including descendants, top-down. */
  traverse(fn) {
    for (const node of this.listChildren()) node.traverse(fn);
    return this;
  }
};
var Skin = class extends ExtensibleProperty {
  init() {
    this.propertyType = "Skin";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      skeleton: null,
      inverseBindMatrices: null,
      joints: new RefSet()
    });
  }
  /**
  * {@link Node} used as a skeleton root. The node must be the closest common root of the joints
  * hierarchy or a direct or indirect parent node of the closest common root.
  */
  getSkeleton() {
    return this.getRef("skeleton");
  }
  /**
  * {@link Node} used as a skeleton root. The node must be the closest common root of the joints
  * hierarchy or a direct or indirect parent node of the closest common root.
  */
  setSkeleton(skeleton) {
    return this.setRef("skeleton", skeleton);
  }
  /**
  * {@link Accessor} containing the floating-point 4x4 inverse-bind matrices. The default is
  * that each matrix is a 4x4 identity matrix, which implies that inverse-bind matrices were
  * pre-applied.
  */
  getInverseBindMatrices() {
    return this.getRef("inverseBindMatrices");
  }
  /**
  * {@link Accessor} containing the floating-point 4x4 inverse-bind matrices. The default is
  * that each matrix is a 4x4 identity matrix, which implies that inverse-bind matrices were
  * pre-applied.
  */
  setInverseBindMatrices(inverseBindMatrices) {
    return this.setRef("inverseBindMatrices", inverseBindMatrices, { usage: "INVERSE_BIND_MATRICES" });
  }
  /** Adds a joint {@link Node} to this {@link Skin}. */
  addJoint(joint) {
    return this.addRef("joints", joint);
  }
  /** Removes a joint {@link Node} from this {@link Skin}. */
  removeJoint(joint) {
    return this.removeRef("joints", joint);
  }
  /** Lists joints ({@link Node}s used as joints or bones) in this {@link Skin}. */
  listJoints() {
    return this.listRefs("joints");
  }
};
var Texture = class extends ExtensibleProperty {
  init() {
    this.propertyType = "Texture";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      image: null,
      mimeType: "",
      uri: ""
    });
  }
  /**********************************************************************************************
  * MIME type / format.
  */
  /** Returns the MIME type for this texture ('image/jpeg' or 'image/png'). */
  getMimeType() {
    return this.get("mimeType") || ImageUtils.extensionToMimeType(FileUtils.extension(this.get("uri")));
  }
  /**
  * Sets the MIME type for this texture ('image/jpeg' or 'image/png'). If the texture does not
  * have a URI, a MIME type is required for correct export.
  */
  setMimeType(mimeType) {
    return this.set("mimeType", mimeType);
  }
  /**********************************************************************************************
  * URI / filename.
  */
  /** Returns the URI (e.g. 'path/to/file.png') for this texture. */
  getURI() {
    return this.get("uri");
  }
  /**
  * Sets the URI (e.g. 'path/to/file.png') for this texture. If the texture does not have a MIME
  * type, a URI is required for correct export.
  */
  setURI(uri) {
    this.set("uri", uri);
    const mimeType = ImageUtils.extensionToMimeType(FileUtils.extension(uri));
    if (mimeType) this.set("mimeType", mimeType);
    return this;
  }
  /**********************************************************************************************
  * Image data.
  */
  /** Returns the raw image data for this texture. */
  getImage() {
    return this.get("image");
  }
  /** Sets the raw image data for this texture. */
  setImage(image) {
    return this.set("image", BufferUtils.assertView(image));
  }
  /** Returns the size, in pixels, of this texture. */
  getSize() {
    const image = this.get("image");
    if (!image) return null;
    return ImageUtils.getSize(image, this.getMimeType());
  }
};
var Root = class extends ExtensibleProperty {
  _extensions = /* @__PURE__ */ new Set();
  init() {
    this.propertyType = "Root";
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      asset: {
        generator: `glTF-Transform ${VERSION}`,
        version: "2.0"
      },
      defaultScene: null,
      accessors: new RefSet(),
      animations: new RefSet(),
      buffers: new RefSet(),
      cameras: new RefSet(),
      materials: new RefSet(),
      meshes: new RefSet(),
      nodes: new RefSet(),
      scenes: new RefSet(),
      skins: new RefSet(),
      textures: new RefSet()
    });
  }
  /** @internal */
  constructor(graph) {
    super(graph);
    graph.addEventListener("node:create", (event) => {
      this._addChildOfRoot(event.target);
    });
  }
  clone() {
    throw new Error("Root cannot be cloned.");
  }
  copy(other, resolve = COPY_IDENTITY) {
    if (resolve === COPY_IDENTITY) throw new Error("Root cannot be copied.");
    this.set("asset", { ...other.get("asset") });
    this.setName(other.getName());
    this.setExtras({ ...other.getExtras() });
    this.setDefaultScene(other.getDefaultScene() ? resolve(other.getDefaultScene()) : null);
    for (const extensionName of other.listRefMapKeys("extensions")) {
      const otherExtension = other.getExtension(extensionName);
      this.setExtension(extensionName, resolve(otherExtension));
    }
    return this;
  }
  _addChildOfRoot(child) {
    if (child instanceof Scene) this.addRef("scenes", child);
    else if (child instanceof Node) this.addRef("nodes", child);
    else if (child instanceof Camera) this.addRef("cameras", child);
    else if (child instanceof Skin) this.addRef("skins", child);
    else if (child instanceof Mesh) this.addRef("meshes", child);
    else if (child instanceof Material) this.addRef("materials", child);
    else if (child instanceof Texture) this.addRef("textures", child);
    else if (child instanceof Animation) this.addRef("animations", child);
    else if (child instanceof Accessor) this.addRef("accessors", child);
    else if (child instanceof Buffer$1) this.addRef("buffers", child);
    return this;
  }
  /**
  * Returns the `asset` object, which specifies the target glTF version of the asset. Additional
  * metadata can be stored in optional properties such as `generator` or `copyright`.
  *
  * Reference: [glTF → Asset](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#asset)
  */
  getAsset() {
    return this.get("asset");
  }
  /**********************************************************************************************
  * Extensions.
  */
  /** Lists all {@link Extension Extensions} enabled for this root. */
  listExtensionsUsed() {
    return Array.from(this._extensions);
  }
  /** Lists all {@link Extension Extensions} enabled and required for this root. */
  listExtensionsRequired() {
    return this.listExtensionsUsed().filter((extension) => extension.isRequired());
  }
  /** @internal */
  _enableExtension(extension) {
    this._extensions.add(extension);
    return this;
  }
  /** @internal */
  _disableExtension(extension) {
    this._extensions.delete(extension);
    return this;
  }
  /**********************************************************************************************
  * Properties.
  */
  /** Lists all {@link Scene} properties associated with this root. */
  listScenes() {
    return this.listRefs("scenes");
  }
  /** Default {@link Scene} associated with this root. */
  setDefaultScene(defaultScene) {
    return this.setRef("defaultScene", defaultScene);
  }
  /** Default {@link Scene} associated with this root. */
  getDefaultScene() {
    return this.getRef("defaultScene");
  }
  /** Lists all {@link Node} properties associated with this root. */
  listNodes() {
    return this.listRefs("nodes");
  }
  /** Lists all {@link Camera} properties associated with this root. */
  listCameras() {
    return this.listRefs("cameras");
  }
  /** Lists all {@link Skin} properties associated with this root. */
  listSkins() {
    return this.listRefs("skins");
  }
  /** Lists all {@link Mesh} properties associated with this root. */
  listMeshes() {
    return this.listRefs("meshes");
  }
  /** Lists all {@link Material} properties associated with this root. */
  listMaterials() {
    return this.listRefs("materials");
  }
  /** Lists all {@link Texture} properties associated with this root. */
  listTextures() {
    return this.listRefs("textures");
  }
  /** Lists all {@link Animation} properties associated with this root. */
  listAnimations() {
    return this.listRefs("animations");
  }
  /** Lists all {@link Accessor} properties associated with this root. */
  listAccessors() {
    return this.listRefs("accessors");
  }
  /** Lists all {@link Buffer} properties associated with this root. */
  listBuffers() {
    return this.listRefs("buffers");
  }
};
var Document = class Document2 {
  _graph = new Graph();
  _root = new Root(this._graph);
  _logger = Logger.DEFAULT_INSTANCE;
  /**
  * Enables lookup of a Document from its Graph. For internal use, only.
  * @internal
  * @experimental
  */
  static _GRAPH_DOCUMENTS = /* @__PURE__ */ new WeakMap();
  /**
  * Returns the Document associated with a given Graph, if any.
  * @hidden
  * @experimental
  */
  static fromGraph(graph) {
    return Document2._GRAPH_DOCUMENTS.get(graph) || null;
  }
  /** Creates a new Document, representing an empty glTF asset. */
  constructor() {
    Document2._GRAPH_DOCUMENTS.set(this._graph, this);
  }
  /** Returns the glTF {@link Root} property. */
  getRoot() {
    return this._root;
  }
  /**
  * Returns the {@link Graph} representing connectivity of resources within this document.
  * @hidden
  */
  getGraph() {
    return this._graph;
  }
  /** Returns the {@link Logger} instance used for any operations performed on this document. */
  getLogger() {
    return this._logger;
  }
  /**
  * Overrides the {@link Logger} instance used for any operations performed on this document.
  *
  * Usage:
  *
  * ```ts
  * doc
  * 	.setLogger(new Logger(Logger.Verbosity.SILENT))
  * 	.transform(dedup(), weld());
  * ```
  */
  setLogger(logger) {
    this._logger = logger;
    return this;
  }
  /**
  * Clones this Document, copying all resources within it.
  * @deprecated Use 'cloneDocument(document)' from '@gltf-transform/functions'.
  * @hidden
  * @internal
  */
  clone() {
    throw new Error(`Use 'cloneDocument(source)' from '@gltf-transform/functions'.`);
  }
  /**
  * Merges the content of another Document into this one, without affecting the original.
  * @deprecated Use 'mergeDocuments(target, source)' from '@gltf-transform/functions'.
  * @hidden
  * @internal
  */
  merge(_other) {
    throw new Error(`Use 'mergeDocuments(target, source)' from '@gltf-transform/functions'.`);
  }
  /**
  * Applies a series of modifications to this document. Each transformation is asynchronous,
  * takes the {@link Document} as input, and returns nothing. Transforms are applied in the
  * order given, which may affect the final result.
  *
  * Usage:
  *
  * ```ts
  * await doc.transform(
  * 	dedup(),
  * 	prune()
  * );
  * ```
  *
  * @param transforms List of synchronous transformation functions to apply.
  */
  async transform(...transforms) {
    const stack = transforms.map((fn) => fn.name);
    for (const transform of transforms) await transform(this, { stack });
    return this;
  }
  /**********************************************************************************************
  * Extension management methods.
  */
  /**
  * Returns true if an {@link Extension} with the given name exists on the document, otherwise false.
  */
  hasExtension(extensionName) {
    return this.getRoot().listExtensionsUsed().some((ext) => ext.extensionName === extensionName);
  }
  /**
  * Creates a new {@link Extension}, for the extension type of the given constructor. If the
  * extension is already enabled for this Document, the previous Extension reference is reused.
  */
  createExtension(ctor) {
    const extensionName = ctor.EXTENSION_NAME;
    return this.getRoot().listExtensionsUsed().find((ext) => ext.extensionName === extensionName) || new ctor(this);
  }
  /**
  * Disables and removes an {@link Extension} from the Document. If no Extension exists with
  * the given name, this method has no effect.
  */
  disposeExtension(extensionName) {
    const extension = this.getRoot().listExtensionsUsed().find((ext) => ext.extensionName === extensionName);
    if (extension) extension.dispose();
  }
  /**********************************************************************************************
  * Property factory methods.
  */
  /** Creates a new {@link Scene} attached to this document's {@link Root}. */
  createScene(name = "") {
    return new Scene(this._graph, name);
  }
  /** Creates a new {@link Node} attached to this document's {@link Root}. */
  createNode(name = "") {
    return new Node(this._graph, name);
  }
  /** Creates a new {@link Camera} attached to this document's {@link Root}. */
  createCamera(name = "") {
    return new Camera(this._graph, name);
  }
  /** Creates a new {@link Skin} attached to this document's {@link Root}. */
  createSkin(name = "") {
    return new Skin(this._graph, name);
  }
  /** Creates a new {@link Mesh} attached to this document's {@link Root}. */
  createMesh(name = "") {
    return new Mesh(this._graph, name);
  }
  /**
  * Creates a new {@link Primitive}. Primitives must be attached to a {@link Mesh}
  * for use and export; they are not otherwise associated with a {@link Root}.
  */
  createPrimitive() {
    return new Primitive(this._graph);
  }
  /**
  * Creates a new {@link PrimitiveTarget}, or morph target. Targets must be attached to a
  * {@link Primitive} for use and export; they are not otherwise associated with a {@link Root}.
  */
  createPrimitiveTarget(name = "") {
    return new PrimitiveTarget(this._graph, name);
  }
  /** Creates a new {@link Material} attached to this document's {@link Root}. */
  createMaterial(name = "") {
    return new Material(this._graph, name);
  }
  /** Creates a new {@link Texture} attached to this document's {@link Root}. */
  createTexture(name = "") {
    return new Texture(this._graph, name);
  }
  /** Creates a new {@link Animation} attached to this document's {@link Root}. */
  createAnimation(name = "") {
    return new Animation(this._graph, name);
  }
  /**
  * Creates a new {@link AnimationChannel}. Channels must be attached to an {@link Animation}
  * for use and export; they are not otherwise associated with a {@link Root}.
  */
  createAnimationChannel(name = "") {
    return new AnimationChannel(this._graph, name);
  }
  /**
  * Creates a new {@link AnimationSampler}. Samplers must be attached to an {@link Animation}
  * for use and export; they are not otherwise associated with a {@link Root}.
  */
  createAnimationSampler(name = "") {
    return new AnimationSampler(this._graph, name);
  }
  /** Creates a new {@link Accessor} attached to this document's {@link Root}. */
  createAccessor(name = "", buffer = null) {
    if (!buffer) buffer = this.getRoot().listBuffers()[0];
    return new Accessor(this._graph, name).setBuffer(buffer);
  }
  /** Creates a new {@link Buffer} attached to this document's {@link Root}. */
  createBuffer(name = "") {
    return new Buffer$1(this._graph, name);
  }
};
var Extension = class {
  /** Official name of the extension. */
  static EXTENSION_NAME;
  /** Official name of the extension. */
  extensionName = "";
  /**
  * Before reading, extension should be called for these {@link Property} types. *Most
  * extensions don't need to implement this.*
  * @hidden
  */
  prereadTypes = [];
  /**
  * Before writing, extension should be called for these {@link Property} types. *Most
  * extensions don't need to implement this.*
  * @hidden
  */
  prewriteTypes = [];
  /** @hidden Dependency IDs needed to read this extension, to be installed before I/O. */
  readDependencies = [];
  /** @hidden Dependency IDs needed to write this extension, to be installed before I/O. */
  writeDependencies = [];
  /** @hidden */
  document;
  /** @hidden */
  required = false;
  /** @hidden */
  properties = /* @__PURE__ */ new Set();
  /** @hidden */
  _listener;
  /** @hidden */
  constructor(document) {
    this.document = document;
    document.getRoot()._enableExtension(this);
    this._listener = (_event) => {
      const event = _event;
      const target = event.target;
      if (target instanceof ExtensionProperty && target.extensionName === this.extensionName) {
        if (event.type === "node:create") this._addExtensionProperty(target);
        if (event.type === "node:dispose") this._removeExtensionProperty(target);
      }
    };
    const graph = document.getGraph();
    graph.addEventListener("node:create", this._listener);
    graph.addEventListener("node:dispose", this._listener);
  }
  /** Disables and removes the extension from the Document. */
  dispose() {
    this.document.getRoot()._disableExtension(this);
    const graph = this.document.getGraph();
    graph.removeEventListener("node:create", this._listener);
    graph.removeEventListener("node:dispose", this._listener);
    for (const property of this.properties) property.dispose();
  }
  /** @hidden Performs first-time setup for the extension. Must be idempotent. */
  static register() {
  }
  /**
  * Indicates to the client whether it is OK to load the asset when this extension is not
  * recognized. Optional extensions are generally preferred, if there is not a good reason
  * to require a client to completely fail when an extension isn't known.
  */
  isRequired() {
    return this.required;
  }
  /**
  * Indicates to the client whether it is OK to load the asset when this extension is not
  * recognized. Optional extensions are generally preferred, if there is not a good reason
  * to require a client to completely fail when an extension isn't known.
  */
  setRequired(required) {
    this.required = required;
    return this;
  }
  /**
  * Lists all {@link ExtensionProperty} instances associated with, or created by, this
  * extension. Includes only instances that are attached to the Document's graph; detached
  * instances will be excluded.
  */
  listProperties() {
    return Array.from(this.properties);
  }
  /**********************************************************************************************
  * ExtensionProperty management.
  */
  /** @internal */
  _addExtensionProperty(property) {
    this.properties.add(property);
    return this;
  }
  /** @internal */
  _removeExtensionProperty(property) {
    this.properties.delete(property);
    return this;
  }
  /**********************************************************************************************
  * I/O implementation.
  */
  /** @hidden Installs dependencies required by the extension. */
  install(_key, _dependency) {
    return this;
  }
  /**
  * Used by the {@link PlatformIO} utilities when reading a glTF asset. This method may
  * optionally be implemented by an extension, and should then support any property type
  * declared by the Extension's {@link Extension.prereadTypes} list. The Extension will
  * be given a ReaderContext instance, and is expected to update either the context or its
  * {@link JSONDocument} with resources known to the Extension. *Most extensions don't need to
  * implement this.*
  * @hidden
  */
  preread(_readerContext, _propertyType) {
    return this;
  }
  /**
  * Used by the {@link PlatformIO} utilities when writing a glTF asset. This method may
  * optionally be implemented by an extension, and should then support any property type
  * declared by the Extension's {@link Extension.prewriteTypes} list. The Extension will
  * be given a WriterContext instance, and is expected to update either the context or its
  * {@link JSONDocument} with resources known to the Extension. *Most extensions don't need to
  * implement this.*
  * @hidden
  */
  prewrite(_writerContext, _propertyType) {
    return this;
  }
};
var ReaderContext = class {
  jsonDoc;
  buffers = [];
  bufferViews = [];
  bufferViewBuffers = [];
  accessors = [];
  textures = [];
  textureInfos = /* @__PURE__ */ new Map();
  materials = [];
  meshes = [];
  cameras = [];
  nodes = [];
  skins = [];
  animations = [];
  scenes = [];
  constructor(jsonDoc) {
    this.jsonDoc = jsonDoc;
  }
  setTextureInfo(textureInfo, textureInfoDef) {
    this.textureInfos.set(textureInfo, textureInfoDef);
    if (textureInfoDef.texCoord !== void 0) textureInfo.setTexCoord(textureInfoDef.texCoord);
    if (textureInfoDef.extras !== void 0) textureInfo.setExtras(textureInfoDef.extras);
    const textureDef = this.jsonDoc.json.textures[textureInfoDef.index];
    if (textureDef.sampler === void 0) return;
    const samplerDef = this.jsonDoc.json.samplers[textureDef.sampler];
    if (samplerDef.magFilter !== void 0) textureInfo.setMagFilter(samplerDef.magFilter);
    if (samplerDef.minFilter !== void 0) textureInfo.setMinFilter(samplerDef.minFilter);
    if (samplerDef.wrapS !== void 0) textureInfo.setWrapS(samplerDef.wrapS);
    if (samplerDef.wrapT !== void 0) textureInfo.setWrapT(samplerDef.wrapT);
  }
};
var DEFAULT_OPTIONS = {
  logger: Logger.DEFAULT_INSTANCE,
  extensions: [],
  dependencies: {}
};
var SUPPORTED_PREREAD_TYPES = /* @__PURE__ */ new Set([
  "Buffer",
  "Texture",
  "Material",
  "Mesh",
  "Primitive",
  "Node",
  "Scene"
]);
var GLTFReader = class {
  static read(jsonDoc, _options = DEFAULT_OPTIONS) {
    const options = {
      ...DEFAULT_OPTIONS,
      ..._options
    };
    const { json } = jsonDoc;
    const document = new Document().setLogger(options.logger);
    this.validate(jsonDoc, options);
    const context = new ReaderContext(jsonDoc);
    const assetDef = json.asset;
    const asset = document.getRoot().getAsset();
    if (assetDef.copyright) asset.copyright = assetDef.copyright;
    if (assetDef.extras) asset.extras = assetDef.extras;
    if (json.extras !== void 0) document.getRoot().setExtras({ ...json.extras });
    const extensionsUsed = json.extensionsUsed || [];
    const extensionsRequired = json.extensionsRequired || [];
    options.extensions.sort((a, b) => a.EXTENSION_NAME > b.EXTENSION_NAME ? 1 : -1);
    for (const Extension2 of options.extensions) if (extensionsUsed.includes(Extension2.EXTENSION_NAME)) {
      const extension = document.createExtension(Extension2).setRequired(extensionsRequired.includes(Extension2.EXTENSION_NAME));
      const unsupportedHooks = extension.prereadTypes.filter((type) => !SUPPORTED_PREREAD_TYPES.has(type));
      if (unsupportedHooks.length) options.logger.warn(`Preread hooks for some types (${unsupportedHooks.join()}), requested by extension ${extension.extensionName}, are unsupported. Please file an issue or a PR.`);
      for (const key of extension.readDependencies) extension.install(key, options.dependencies[key]);
    }
    const bufferDefs = json.buffers || [];
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes("Buffer")).forEach((extension) => extension.preread(context, "Buffer"));
    context.buffers = bufferDefs.map((bufferDef) => {
      const buffer = document.createBuffer(bufferDef.name);
      if (bufferDef.extras) buffer.setExtras(bufferDef.extras);
      if (bufferDef.uri && bufferDef.uri.indexOf("__") !== 0) buffer.setURI(bufferDef.uri);
      return buffer;
    });
    context.bufferViewBuffers = (json.bufferViews || []).map((bufferViewDef, index) => {
      if (!context.bufferViews[index]) {
        const bufferDef = jsonDoc.json.buffers[bufferViewDef.buffer];
        const bufferData = bufferDef.uri ? jsonDoc.resources[bufferDef.uri] : jsonDoc.resources[GLB_BUFFER];
        const byteOffset = bufferViewDef.byteOffset || 0;
        context.bufferViews[index] = BufferUtils.toView(bufferData, byteOffset, bufferViewDef.byteLength);
      }
      return context.buffers[bufferViewDef.buffer];
    });
    const accessorDefs = json.accessors || [];
    context.accessors = accessorDefs.map((accessorDef) => {
      const buffer = context.bufferViewBuffers[accessorDef.bufferView];
      const accessor = document.createAccessor(accessorDef.name, buffer).setType(accessorDef.type);
      if (accessorDef.extras) accessor.setExtras(accessorDef.extras);
      if (accessorDef.normalized !== void 0) accessor.setNormalized(accessorDef.normalized);
      if (accessorDef.bufferView === void 0) return accessor;
      accessor.setArray(getAccessorArray(accessorDef, context));
      return accessor;
    });
    const imageDefs = json.images || [];
    const textureDefs = json.textures || [];
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes("Texture")).forEach((extension) => extension.preread(context, "Texture"));
    context.textures = imageDefs.map((imageDef) => {
      const texture = document.createTexture(imageDef.name);
      if (imageDef.extras) texture.setExtras(imageDef.extras);
      if (imageDef.bufferView !== void 0) {
        const bufferViewDef = json.bufferViews[imageDef.bufferView];
        const bufferDef = jsonDoc.json.buffers[bufferViewDef.buffer];
        const bufferData = bufferDef.uri ? jsonDoc.resources[bufferDef.uri] : jsonDoc.resources[GLB_BUFFER];
        const byteOffset = bufferViewDef.byteOffset || 0;
        const byteLength = bufferViewDef.byteLength;
        const imageData = bufferData.slice(byteOffset, byteOffset + byteLength);
        texture.setImage(imageData);
      } else if (imageDef.uri !== void 0) {
        texture.setImage(jsonDoc.resources[imageDef.uri]);
        if (imageDef.uri.indexOf("__") !== 0) texture.setURI(imageDef.uri);
      }
      if (imageDef.mimeType !== void 0) texture.setMimeType(imageDef.mimeType);
      else if (imageDef.uri) {
        const extension = FileUtils.extension(imageDef.uri);
        texture.setMimeType(ImageUtils.extensionToMimeType(extension));
      }
      return texture;
    });
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes("Material")).forEach((extension) => extension.preread(context, "Material"));
    context.materials = (json.materials || []).map((materialDef) => {
      const material = document.createMaterial(materialDef.name);
      if (materialDef.extras) material.setExtras(materialDef.extras);
      if (materialDef.alphaMode !== void 0) material.setAlphaMode(materialDef.alphaMode);
      if (materialDef.alphaCutoff !== void 0) material.setAlphaCutoff(materialDef.alphaCutoff);
      if (materialDef.doubleSided !== void 0) material.setDoubleSided(materialDef.doubleSided);
      const pbrDef = materialDef.pbrMetallicRoughness || {};
      if (pbrDef.baseColorFactor !== void 0) material.setBaseColorFactor(pbrDef.baseColorFactor);
      if (materialDef.emissiveFactor !== void 0) material.setEmissiveFactor(materialDef.emissiveFactor);
      if (pbrDef.metallicFactor !== void 0) material.setMetallicFactor(pbrDef.metallicFactor);
      if (pbrDef.roughnessFactor !== void 0) material.setRoughnessFactor(pbrDef.roughnessFactor);
      if (pbrDef.baseColorTexture !== void 0) {
        const textureInfoDef = pbrDef.baseColorTexture;
        const texture = context.textures[textureDefs[textureInfoDef.index].source];
        material.setBaseColorTexture(texture);
        context.setTextureInfo(material.getBaseColorTextureInfo(), textureInfoDef);
      }
      if (materialDef.emissiveTexture !== void 0) {
        const textureInfoDef = materialDef.emissiveTexture;
        const texture = context.textures[textureDefs[textureInfoDef.index].source];
        material.setEmissiveTexture(texture);
        context.setTextureInfo(material.getEmissiveTextureInfo(), textureInfoDef);
      }
      if (materialDef.normalTexture !== void 0) {
        const textureInfoDef = materialDef.normalTexture;
        const texture = context.textures[textureDefs[textureInfoDef.index].source];
        material.setNormalTexture(texture);
        context.setTextureInfo(material.getNormalTextureInfo(), textureInfoDef);
        if (materialDef.normalTexture.scale !== void 0) material.setNormalScale(materialDef.normalTexture.scale);
      }
      if (materialDef.occlusionTexture !== void 0) {
        const textureInfoDef = materialDef.occlusionTexture;
        const texture = context.textures[textureDefs[textureInfoDef.index].source];
        material.setOcclusionTexture(texture);
        context.setTextureInfo(material.getOcclusionTextureInfo(), textureInfoDef);
        if (materialDef.occlusionTexture.strength !== void 0) material.setOcclusionStrength(materialDef.occlusionTexture.strength);
      }
      if (pbrDef.metallicRoughnessTexture !== void 0) {
        const textureInfoDef = pbrDef.metallicRoughnessTexture;
        const texture = context.textures[textureDefs[textureInfoDef.index].source];
        material.setMetallicRoughnessTexture(texture);
        context.setTextureInfo(material.getMetallicRoughnessTextureInfo(), textureInfoDef);
      }
      return material;
    });
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes("Mesh")).forEach((extension) => extension.preread(context, "Mesh"));
    const meshDefs = json.meshes || [];
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes("Primitive")).forEach((extension) => extension.preread(context, "Primitive"));
    context.meshes = meshDefs.map((meshDef) => {
      const mesh = document.createMesh(meshDef.name);
      if (meshDef.extras) mesh.setExtras(meshDef.extras);
      if (meshDef.weights !== void 0) mesh.setWeights(meshDef.weights);
      (meshDef.primitives || []).forEach((primitiveDef) => {
        const primitive = document.createPrimitive();
        if (primitiveDef.extras) primitive.setExtras(primitiveDef.extras);
        if (primitiveDef.material !== void 0) primitive.setMaterial(context.materials[primitiveDef.material]);
        if (primitiveDef.mode !== void 0) primitive.setMode(primitiveDef.mode);
        for (const [semantic, index] of Object.entries(primitiveDef.attributes || {})) primitive.setAttribute(semantic, context.accessors[index]);
        if (primitiveDef.indices !== void 0) primitive.setIndices(context.accessors[primitiveDef.indices]);
        const targetNames = meshDef.extras && meshDef.extras.targetNames || [];
        (primitiveDef.targets || []).forEach((targetDef, targetIndex) => {
          const targetName = targetNames[targetIndex] || targetIndex.toString();
          const target = document.createPrimitiveTarget(targetName);
          for (const [semantic, accessorIndex] of Object.entries(targetDef)) target.setAttribute(semantic, context.accessors[accessorIndex]);
          primitive.addTarget(target);
        });
        mesh.addPrimitive(primitive);
      });
      return mesh;
    });
    context.cameras = (json.cameras || []).map((cameraDef) => {
      const camera = document.createCamera(cameraDef.name).setType(cameraDef.type);
      if (cameraDef.extras) camera.setExtras(cameraDef.extras);
      if (cameraDef.type === Camera.Type.PERSPECTIVE) {
        const perspectiveDef = cameraDef.perspective;
        camera.setYFov(perspectiveDef.yfov);
        camera.setZNear(perspectiveDef.znear);
        if (perspectiveDef.zfar !== void 0) camera.setZFar(perspectiveDef.zfar);
        if (perspectiveDef.aspectRatio !== void 0) camera.setAspectRatio(perspectiveDef.aspectRatio);
      } else {
        const orthoDef = cameraDef.orthographic;
        camera.setZNear(orthoDef.znear).setZFar(orthoDef.zfar).setXMag(orthoDef.xmag).setYMag(orthoDef.ymag);
      }
      return camera;
    });
    const nodeDefs = json.nodes || [];
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes("Node")).forEach((extension) => extension.preread(context, "Node"));
    context.nodes = nodeDefs.map((nodeDef) => {
      const node = document.createNode(nodeDef.name);
      if (nodeDef.extras) node.setExtras(nodeDef.extras);
      if (nodeDef.translation !== void 0) node.setTranslation(nodeDef.translation);
      if (nodeDef.rotation !== void 0) node.setRotation(nodeDef.rotation);
      if (nodeDef.scale !== void 0) node.setScale(nodeDef.scale);
      if (nodeDef.matrix !== void 0) {
        const translation = [
          0,
          0,
          0
        ];
        const rotation = [
          0,
          0,
          0,
          1
        ];
        const scale = [
          1,
          1,
          1
        ];
        MathUtils.decompose(nodeDef.matrix, translation, rotation, scale);
        node.setTranslation(translation);
        node.setRotation(rotation);
        node.setScale(scale);
      }
      if (nodeDef.weights !== void 0) node.setWeights(nodeDef.weights);
      return node;
    });
    context.skins = (json.skins || []).map((skinDef) => {
      const skin = document.createSkin(skinDef.name);
      if (skinDef.extras) skin.setExtras(skinDef.extras);
      if (skinDef.inverseBindMatrices !== void 0) skin.setInverseBindMatrices(context.accessors[skinDef.inverseBindMatrices]);
      if (skinDef.skeleton !== void 0) skin.setSkeleton(context.nodes[skinDef.skeleton]);
      for (const nodeIndex of skinDef.joints) skin.addJoint(context.nodes[nodeIndex]);
      return skin;
    });
    nodeDefs.map((nodeDef, nodeIndex) => {
      const node = context.nodes[nodeIndex];
      (nodeDef.children || []).forEach((childIndex) => node.addChild(context.nodes[childIndex]));
      if (nodeDef.mesh !== void 0) node.setMesh(context.meshes[nodeDef.mesh]);
      if (nodeDef.camera !== void 0) node.setCamera(context.cameras[nodeDef.camera]);
      if (nodeDef.skin !== void 0) node.setSkin(context.skins[nodeDef.skin]);
    });
    context.animations = (json.animations || []).map((animationDef) => {
      const animation = document.createAnimation(animationDef.name);
      if (animationDef.extras) animation.setExtras(animationDef.extras);
      const samplers = (animationDef.samplers || []).map((samplerDef) => {
        const sampler = document.createAnimationSampler().setInput(context.accessors[samplerDef.input]).setOutput(context.accessors[samplerDef.output]).setInterpolation(samplerDef.interpolation || AnimationSampler.Interpolation.LINEAR);
        if (samplerDef.extras) sampler.setExtras(samplerDef.extras);
        animation.addSampler(sampler);
        return sampler;
      });
      (animationDef.channels || []).forEach((channelDef) => {
        const channel = document.createAnimationChannel().setSampler(samplers[channelDef.sampler]).setTargetPath(channelDef.target.path);
        if (channelDef.target.node !== void 0) channel.setTargetNode(context.nodes[channelDef.target.node]);
        if (channelDef.extras) channel.setExtras(channelDef.extras);
        animation.addChannel(channel);
      });
      return animation;
    });
    const sceneDefs = json.scenes || [];
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes("Scene")).forEach((extension) => extension.preread(context, "Scene"));
    context.scenes = sceneDefs.map((sceneDef) => {
      const scene = document.createScene(sceneDef.name);
      if (sceneDef.extras) scene.setExtras(sceneDef.extras);
      (sceneDef.nodes || []).map((nodeIndex) => context.nodes[nodeIndex]).forEach((node) => scene.addChild(node));
      return scene;
    });
    if (json.scene !== void 0) document.getRoot().setDefaultScene(context.scenes[json.scene]);
    document.getRoot().listExtensionsUsed().forEach((extension) => extension.read(context));
    accessorDefs.forEach((accessorDef, index) => {
      const accessor = context.accessors[index];
      const hasSparseValues = !!accessorDef.sparse;
      const isZeroFilled = !accessorDef.bufferView && !accessor.getArray();
      if (hasSparseValues || isZeroFilled) accessor.setSparse(true).setArray(getSparseArray(accessorDef, context));
    });
    return document;
  }
  static validate(jsonDoc, options) {
    const json = jsonDoc.json;
    if (json.asset.version !== "2.0") throw new Error(`Unsupported glTF version, "${json.asset.version}".`);
    if (json.extensionsRequired) {
      for (const extensionName of json.extensionsRequired) if (!options.extensions.find((extension) => extension.EXTENSION_NAME === extensionName)) throw new Error(`Missing required extension, "${extensionName}".`);
    }
    if (json.extensionsUsed) {
      for (const extensionName of json.extensionsUsed) if (!options.extensions.find((extension) => extension.EXTENSION_NAME === extensionName)) options.logger.warn(`Missing optional extension, "${extensionName}".`);
    }
  }
};
function getInterleavedArray(accessorDef, context) {
  const jsonDoc = context.jsonDoc;
  const bufferView = context.bufferViews[accessorDef.bufferView];
  const bufferViewDef = jsonDoc.json.bufferViews[accessorDef.bufferView];
  const TypedArray = ComponentTypeToTypedArray[accessorDef.componentType];
  const elementSize = Accessor.getElementSize(accessorDef.type);
  const componentSize = TypedArray.BYTES_PER_ELEMENT;
  const accessorByteOffset = accessorDef.byteOffset || 0;
  const array = new TypedArray(accessorDef.count * elementSize);
  const view = new DataView(bufferView.buffer, bufferView.byteOffset, bufferView.byteLength);
  const byteStride = bufferViewDef.byteStride;
  for (let i = 0; i < accessorDef.count; i++) for (let j = 0; j < elementSize; j++) {
    const byteOffset = accessorByteOffset + i * byteStride + j * componentSize;
    let value;
    switch (accessorDef.componentType) {
      case Accessor.ComponentType.FLOAT:
        value = view.getFloat32(byteOffset, true);
        break;
      case Accessor.ComponentType.UNSIGNED_INT:
        value = view.getUint32(byteOffset, true);
        break;
      case Accessor.ComponentType.UNSIGNED_SHORT:
        value = view.getUint16(byteOffset, true);
        break;
      case Accessor.ComponentType.UNSIGNED_BYTE:
        value = view.getUint8(byteOffset);
        break;
      case Accessor.ComponentType.SHORT:
        value = view.getInt16(byteOffset, true);
        break;
      case Accessor.ComponentType.BYTE:
        value = view.getInt8(byteOffset);
        break;
      case Accessor.ComponentType.FLOAT16:
        value = view.getFloat16(byteOffset, true);
        break;
      case Accessor.ComponentType.FLOAT64:
        value = view.getFloat64(byteOffset, true);
        break;
      default:
        throw new Error(`Unexpected componentType "${accessorDef.componentType}".`);
    }
    array[i * elementSize + j] = value;
  }
  return array;
}
function getAccessorArray(accessorDef, context) {
  const jsonDoc = context.jsonDoc;
  const bufferView = context.bufferViews[accessorDef.bufferView];
  const bufferViewDef = jsonDoc.json.bufferViews[accessorDef.bufferView];
  const TypedArray = ComponentTypeToTypedArray[accessorDef.componentType];
  const elementSize = Accessor.getElementSize(accessorDef.type);
  const componentSize = TypedArray.BYTES_PER_ELEMENT;
  const elementStride = elementSize * componentSize;
  if (bufferViewDef.byteStride !== void 0 && bufferViewDef.byteStride !== elementStride) return getInterleavedArray(accessorDef, context);
  const byteOffset = bufferView.byteOffset + (accessorDef.byteOffset || 0);
  const byteLength = accessorDef.count * elementSize * componentSize;
  return new TypedArray(bufferView.buffer.slice(byteOffset, byteOffset + byteLength));
}
function getSparseArray(accessorDef, context) {
  const TypedArray = ComponentTypeToTypedArray[accessorDef.componentType];
  const elementSize = Accessor.getElementSize(accessorDef.type);
  let array;
  if (accessorDef.bufferView !== void 0) array = getAccessorArray(accessorDef, context);
  else array = new TypedArray(accessorDef.count * elementSize);
  const sparseDef = accessorDef.sparse;
  if (!sparseDef) return array;
  const count = sparseDef.count;
  const indicesDef = {
    ...accessorDef,
    ...sparseDef.indices,
    count,
    type: "SCALAR"
  };
  const valuesDef = {
    ...accessorDef,
    ...sparseDef.values,
    count
  };
  const indices = getAccessorArray(indicesDef, context);
  const values = getAccessorArray(valuesDef, context);
  for (let i = 0; i < indicesDef.count; i++) for (let j = 0; j < elementSize; j++) array[indices[i] * elementSize + j] = values[i * elementSize + j];
  return array;
}
var BufferViewTarget = /* @__PURE__ */ (function(BufferViewTarget2) {
  BufferViewTarget2[BufferViewTarget2["ARRAY_BUFFER"] = 34962] = "ARRAY_BUFFER";
  BufferViewTarget2[BufferViewTarget2["ELEMENT_ARRAY_BUFFER"] = 34963] = "ELEMENT_ARRAY_BUFFER";
  return BufferViewTarget2;
})(BufferViewTarget || {});
var WriterContext = class {
  _doc;
  jsonDoc;
  options;
  /** Explicit buffer view targets defined by glTF specification. */
  static BufferViewTarget = BufferViewTarget;
  /**
  * Implicit buffer view usage, not required by glTF specification, but nonetheless useful for
  * proper grouping of accessors into buffer views. Additional usages are defined by extensions,
  * like `EXT_mesh_gpu_instancing`.
  */
  static BufferViewUsage = BufferViewUsage$1;
  /** Maps usage type to buffer view target. Usages not mapped have undefined targets. */
  static USAGE_TO_TARGET = {
    ["ARRAY_BUFFER"]: 34962,
    ["ELEMENT_ARRAY_BUFFER"]: 34963
  };
  accessorIndexMap = /* @__PURE__ */ new Map();
  animationIndexMap = /* @__PURE__ */ new Map();
  bufferIndexMap = /* @__PURE__ */ new Map();
  cameraIndexMap = /* @__PURE__ */ new Map();
  skinIndexMap = /* @__PURE__ */ new Map();
  materialIndexMap = /* @__PURE__ */ new Map();
  meshIndexMap = /* @__PURE__ */ new Map();
  nodeIndexMap = /* @__PURE__ */ new Map();
  imageIndexMap = /* @__PURE__ */ new Map();
  textureDefIndexMap = /* @__PURE__ */ new Map();
  textureInfoDefMap = /* @__PURE__ */ new Map();
  samplerDefIndexMap = /* @__PURE__ */ new Map();
  sceneIndexMap = /* @__PURE__ */ new Map();
  imageBufferViews = [];
  otherBufferViews = /* @__PURE__ */ new Map();
  otherBufferViewsIndexMap = /* @__PURE__ */ new Map();
  extensionData = {};
  bufferURIGenerator;
  imageURIGenerator;
  logger;
  _accessorUsageMap = /* @__PURE__ */ new Map();
  accessorUsageGroupedByParent = /* @__PURE__ */ new Set(["ARRAY_BUFFER"]);
  accessorParents = /* @__PURE__ */ new Map();
  constructor(_doc, jsonDoc, options) {
    this._doc = _doc;
    this.jsonDoc = jsonDoc;
    this.options = options;
    const root = _doc.getRoot();
    const numBuffers = root.listBuffers().length;
    const numImages = root.listTextures().length;
    this.bufferURIGenerator = new UniqueURIGenerator(numBuffers > 1, () => options.basename || "buffer");
    this.imageURIGenerator = new UniqueURIGenerator(numImages > 1, (texture) => getSlot(_doc, texture) || options.basename || "texture");
    this.logger = _doc.getLogger();
  }
  /**
  * Creates a TextureInfo definition, and any Texture or Sampler definitions it requires. If
  * possible, Texture and Sampler definitions are shared.
  */
  createTextureInfoDef(texture, textureInfo) {
    const samplerDef = {
      magFilter: textureInfo.getMagFilter() || void 0,
      minFilter: textureInfo.getMinFilter() || void 0,
      wrapS: textureInfo.getWrapS(),
      wrapT: textureInfo.getWrapT()
    };
    const samplerKey = JSON.stringify(samplerDef);
    if (!this.samplerDefIndexMap.has(samplerKey)) {
      this.samplerDefIndexMap.set(samplerKey, this.jsonDoc.json.samplers.length);
      this.jsonDoc.json.samplers.push(samplerDef);
    }
    const textureDef = {
      source: this.imageIndexMap.get(texture),
      sampler: this.samplerDefIndexMap.get(samplerKey)
    };
    const textureKey = JSON.stringify(textureDef);
    if (!this.textureDefIndexMap.has(textureKey)) {
      this.textureDefIndexMap.set(textureKey, this.jsonDoc.json.textures.length);
      this.jsonDoc.json.textures.push(textureDef);
    }
    const textureInfoDef = { index: this.textureDefIndexMap.get(textureKey) };
    if (textureInfo.getTexCoord() !== 0) textureInfoDef.texCoord = textureInfo.getTexCoord();
    if (Object.keys(textureInfo.getExtras()).length > 0) textureInfoDef.extras = textureInfo.getExtras();
    this.textureInfoDefMap.set(textureInfo, textureInfoDef);
    return textureInfoDef;
  }
  createPropertyDef(property) {
    const def = {};
    if (property.getName()) def.name = property.getName();
    if (Object.keys(property.getExtras()).length > 0) def.extras = property.getExtras();
    return def;
  }
  createAccessorDef(accessor) {
    const accessorDef = this.createPropertyDef(accessor);
    accessorDef.type = accessor.getType();
    accessorDef.componentType = accessor.getComponentType();
    accessorDef.count = accessor.getCount();
    if (this._doc.getGraph().listParentEdges(accessor).some((edge) => edge.getName() === "attributes" && edge.getAttributes().key === "POSITION" || edge.getName() === "input")) {
      accessorDef.max = accessor.getMax([]).map(Math.fround);
      accessorDef.min = accessor.getMin([]).map(Math.fround);
    }
    if (accessor.getNormalized()) accessorDef.normalized = accessor.getNormalized();
    return accessorDef;
  }
  createImageData(imageDef, data, texture) {
    if (this.options.format === "GLB") {
      this.imageBufferViews.push(data);
      imageDef.bufferView = this.jsonDoc.json.bufferViews.length;
      this.jsonDoc.json.bufferViews.push({
        buffer: 0,
        byteOffset: -1,
        byteLength: data.byteLength
      });
    } else {
      const extension = ImageUtils.mimeTypeToExtension(texture.getMimeType());
      imageDef.uri = this.imageURIGenerator.createURI(texture, extension);
      this.assignResourceURI(imageDef.uri, data, false);
    }
  }
  assignResourceURI(uri, data, throwOnConflict) {
    const resources = this.jsonDoc.resources;
    if (!(uri in resources)) {
      resources[uri] = data;
      return;
    }
    if (data === resources[uri]) {
      this.logger.warn(`Duplicate resource URI, "${uri}".`);
      return;
    }
    const conflictMessage = `Resource URI "${uri}" already assigned to different data.`;
    if (!throwOnConflict) {
      this.logger.warn(conflictMessage);
      return;
    }
    throw new Error(conflictMessage);
  }
  /**
  * Returns implicit usage type of the given accessor, related to grouping accessors into
  * buffer views. Usage is a superset of buffer view target, including ARRAY_BUFFER and
  * ELEMENT_ARRAY_BUFFER, but also usages that do not match GPU buffer view targets such as
  * IBMs. Additional usages are defined by extensions, like `EXT_mesh_gpu_instancing`.
  */
  getAccessorUsage(accessor) {
    const cachedUsage = this._accessorUsageMap.get(accessor);
    if (cachedUsage) return cachedUsage;
    if (accessor.getSparse()) return "SPARSE";
    for (const edge of this._doc.getGraph().listParentEdges(accessor)) {
      const { usage } = edge.getAttributes();
      if (usage) return usage;
      if (edge.getParent().propertyType !== "Root") this.logger.warn(`Missing attribute ".usage" on edge, "${edge.getName()}".`);
    }
    return "OTHER";
  }
  /**
  * Sets usage for the given accessor. Some accessor types must be grouped into
  * buffer views with like accessors. This includes the specified buffer view "targets", but
  * also implicit usage like IBMs or instanced mesh attributes. If unspecified, an accessor
  * will be grouped with other accessors of unspecified usage.
  */
  addAccessorToUsageGroup(accessor, usage) {
    const prevUsage = this._accessorUsageMap.get(accessor);
    if (prevUsage && prevUsage !== usage) throw new Error(`Accessor with usage "${prevUsage}" cannot be reused as "${usage}".`);
    this._accessorUsageMap.set(accessor, usage);
    return this;
  }
};
var UniqueURIGenerator = class {
  multiple;
  basename;
  counter = {};
  constructor(multiple, basename) {
    this.multiple = multiple;
    this.basename = basename;
  }
  createURI(object2, extension) {
    if (object2.getURI()) return object2.getURI();
    else if (!this.multiple) return `${this.basename(object2)}.${extension}`;
    else {
      const basename = this.basename(object2);
      this.counter[basename] = this.counter[basename] || 1;
      return `${basename}_${this.counter[basename]++}.${extension}`;
    }
  }
};
function getSlot(document, texture) {
  const edge = document.getGraph().listParentEdges(texture).find((edge2) => edge2.getParent() !== document.getRoot());
  return edge ? edge.getName().replace(/texture$/i, "") : "";
}
var { BufferViewUsage } = WriterContext;
var { UNSIGNED_INT, UNSIGNED_SHORT, UNSIGNED_BYTE } = Accessor.ComponentType;
var SUPPORTED_PREWRITE_TYPES = /* @__PURE__ */ new Set([
  "Accessor",
  "Buffer",
  "Material",
  "Mesh"
]);
var GLTFWriter = class {
  static write(doc, options) {
    const graph = doc.getGraph();
    const root = doc.getRoot();
    const json = {
      asset: {
        generator: `glTF-Transform ${VERSION}`,
        ...root.getAsset()
      },
      extras: { ...root.getExtras() }
    };
    const jsonDoc = {
      json,
      resources: {}
    };
    const context = new WriterContext(doc, jsonDoc, options);
    const logger = options.logger || Logger.DEFAULT_INSTANCE;
    const extensionsRegistered = new Set(options.extensions.map((ext) => ext.EXTENSION_NAME));
    const extensionsUsed = doc.getRoot().listExtensionsUsed().filter((ext) => extensionsRegistered.has(ext.extensionName)).sort((a, b) => a.extensionName > b.extensionName ? 1 : -1);
    const extensionsRequired = doc.getRoot().listExtensionsRequired().filter((ext) => extensionsRegistered.has(ext.extensionName)).sort((a, b) => a.extensionName > b.extensionName ? 1 : -1);
    if (extensionsUsed.length < doc.getRoot().listExtensionsUsed().length) logger.warn("Some extensions were not registered for I/O, and will not be written.");
    for (const extension of extensionsUsed) {
      const unsupportedHooks = extension.prewriteTypes.filter((type) => !SUPPORTED_PREWRITE_TYPES.has(type));
      if (unsupportedHooks.length) logger.warn(`Prewrite hooks for some types (${unsupportedHooks.join()}), requested by extension ${extension.extensionName}, are unsupported. Please file an issue or a PR.`);
      for (const key of extension.writeDependencies) extension.install(key, options.dependencies[key]);
    }
    function concatAccessors(accessors, bufferIndex, bufferByteOffset, bufferViewTarget) {
      const buffers = [];
      let byteLength = 0;
      for (const accessor of accessors) {
        const accessorDef = context.createAccessorDef(accessor);
        accessorDef.bufferView = json.bufferViews.length;
        const accessorArray = accessor.getArray();
        const data = BufferUtils.pad(BufferUtils.toView(accessorArray));
        accessorDef.byteOffset = byteLength;
        byteLength += data.byteLength;
        buffers.push(data);
        context.accessorIndexMap.set(accessor, json.accessors.length);
        json.accessors.push(accessorDef);
      }
      const bufferViewDef = {
        buffer: bufferIndex,
        byteOffset: bufferByteOffset,
        byteLength: BufferUtils.concat(buffers).byteLength
      };
      if (bufferViewTarget) bufferViewDef.target = bufferViewTarget;
      json.bufferViews.push(bufferViewDef);
      return {
        buffers,
        byteLength
      };
    }
    function interleaveAccessors(accessors, bufferIndex, bufferByteOffset) {
      const vertexCount = accessors[0].getCount();
      let byteStride = 0;
      for (const accessor of accessors) {
        const accessorDef = context.createAccessorDef(accessor);
        accessorDef.bufferView = json.bufferViews.length;
        accessorDef.byteOffset = byteStride;
        const elementSize = accessor.getElementSize();
        const componentSize = accessor.getComponentSize();
        byteStride += BufferUtils.padNumber(elementSize * componentSize);
        context.accessorIndexMap.set(accessor, json.accessors.length);
        json.accessors.push(accessorDef);
      }
      const byteLength = vertexCount * byteStride;
      const buffer = new ArrayBuffer(byteLength);
      const view = new DataView(buffer);
      for (let i = 0; i < vertexCount; i++) {
        let vertexByteOffset = 0;
        for (const accessor of accessors) {
          const elementSize = accessor.getElementSize();
          const componentSize = accessor.getComponentSize();
          const componentType = accessor.getComponentType();
          const array = accessor.getArray();
          for (let j = 0; j < elementSize; j++) {
            const viewByteOffset = i * byteStride + vertexByteOffset + j * componentSize;
            const value = array[i * elementSize + j];
            switch (componentType) {
              case Accessor.ComponentType.FLOAT:
                view.setFloat32(viewByteOffset, value, true);
                break;
              case Accessor.ComponentType.BYTE:
                view.setInt8(viewByteOffset, value);
                break;
              case Accessor.ComponentType.SHORT:
                view.setInt16(viewByteOffset, value, true);
                break;
              case Accessor.ComponentType.UNSIGNED_BYTE:
                view.setUint8(viewByteOffset, value);
                break;
              case Accessor.ComponentType.UNSIGNED_SHORT:
                view.setUint16(viewByteOffset, value, true);
                break;
              case Accessor.ComponentType.UNSIGNED_INT:
                view.setUint32(viewByteOffset, value, true);
                break;
              case Accessor.ComponentType.FLOAT16:
                view.setFloat16(viewByteOffset, value, true);
                break;
              case Accessor.ComponentType.FLOAT64:
                view.setFloat64(viewByteOffset, value, true);
                break;
              default:
                throw new Error("Unexpected component type: " + componentType);
            }
          }
          vertexByteOffset += BufferUtils.padNumber(elementSize * componentSize);
        }
      }
      const bufferViewDef = {
        buffer: bufferIndex,
        byteOffset: bufferByteOffset,
        byteLength,
        byteStride,
        target: WriterContext.BufferViewTarget.ARRAY_BUFFER
      };
      json.bufferViews.push(bufferViewDef);
      return {
        byteLength,
        buffers: [new Uint8Array(buffer)]
      };
    }
    function concatSparseAccessors(accessors, bufferIndex, bufferByteOffset) {
      const buffers = [];
      let byteLength = 0;
      const sparseData = /* @__PURE__ */ new Map();
      let maxIndex = -Infinity;
      let needSparseWarning = false;
      for (const accessor of accessors) {
        const accessorDef = context.createAccessorDef(accessor);
        json.accessors.push(accessorDef);
        context.accessorIndexMap.set(accessor, json.accessors.length - 1);
        const indices = [];
        const values = [];
        const el = [];
        const base = new Array(accessor.getElementSize()).fill(0);
        for (let i = 0, il = accessor.getCount(); i < il; i++) {
          accessor.getElement(i, el);
          if (MathUtils.eq(el, base, 0)) continue;
          maxIndex = Math.max(i, maxIndex);
          indices.push(i);
          for (let j = 0; j < el.length; j++) values.push(el[j]);
        }
        const count = indices.length;
        const data = {
          accessorDef,
          count
        };
        sparseData.set(accessor, data);
        if (count === 0) continue;
        if (count > accessor.getCount() / 2) needSparseWarning = true;
        const ValueArray = ComponentTypeToTypedArray[accessor.getComponentType()];
        data.indices = indices;
        data.values = new ValueArray(values);
      }
      if (!Number.isFinite(maxIndex)) return {
        buffers,
        byteLength
      };
      if (needSparseWarning) logger.warn(`Some sparse accessors have >50% non-zero elements, which may increase file size.`);
      const IndexArray = maxIndex < 255 ? Uint8Array : maxIndex < 65535 ? Uint16Array : Uint32Array;
      const IndexComponentType = maxIndex < 255 ? UNSIGNED_BYTE : maxIndex < 65535 ? UNSIGNED_SHORT : UNSIGNED_INT;
      const indicesBufferViewDef = {
        buffer: bufferIndex,
        byteOffset: bufferByteOffset + byteLength,
        byteLength: 0
      };
      for (const accessor of accessors) {
        const data = sparseData.get(accessor);
        if (data.count === 0) continue;
        data.indicesByteOffset = indicesBufferViewDef.byteLength;
        const buffer = BufferUtils.pad(BufferUtils.toView(new IndexArray(data.indices)));
        buffers.push(buffer);
        byteLength += buffer.byteLength;
        indicesBufferViewDef.byteLength += buffer.byteLength;
      }
      json.bufferViews.push(indicesBufferViewDef);
      const indicesBufferViewIndex = json.bufferViews.length - 1;
      const valuesBufferViewDef = {
        buffer: bufferIndex,
        byteOffset: bufferByteOffset + byteLength,
        byteLength: 0
      };
      for (const accessor of accessors) {
        const data = sparseData.get(accessor);
        if (data.count === 0) continue;
        data.valuesByteOffset = valuesBufferViewDef.byteLength;
        const buffer = BufferUtils.pad(BufferUtils.toView(data.values));
        buffers.push(buffer);
        byteLength += buffer.byteLength;
        valuesBufferViewDef.byteLength += buffer.byteLength;
      }
      json.bufferViews.push(valuesBufferViewDef);
      const valuesBufferViewIndex = json.bufferViews.length - 1;
      for (const accessor of accessors) {
        const data = sparseData.get(accessor);
        if (data.count === 0) continue;
        data.accessorDef.sparse = {
          count: data.count,
          indices: {
            bufferView: indicesBufferViewIndex,
            byteOffset: data.indicesByteOffset,
            componentType: IndexComponentType
          },
          values: {
            bufferView: valuesBufferViewIndex,
            byteOffset: data.valuesByteOffset
          }
        };
      }
      return {
        buffers,
        byteLength
      };
    }
    json.accessors = [];
    json.bufferViews = [];
    json.samplers = [];
    json.textures = [];
    json.images = root.listTextures().map((texture, textureIndex) => {
      const imageDef = context.createPropertyDef(texture);
      if (texture.getMimeType()) imageDef.mimeType = texture.getMimeType();
      const image = texture.getImage();
      if (image) context.createImageData(imageDef, image, texture);
      context.imageIndexMap.set(texture, textureIndex);
      return imageDef;
    });
    extensionsUsed.filter((extension) => extension.prewriteTypes.includes("Accessor")).forEach((extension) => extension.prewrite(context, "Accessor"));
    root.listAccessors().forEach((accessor) => {
      const groupByParent = context.accessorUsageGroupedByParent;
      const accessorParents = context.accessorParents;
      if (context.accessorIndexMap.has(accessor)) return;
      const usage = context.getAccessorUsage(accessor);
      context.addAccessorToUsageGroup(accessor, usage);
      if (groupByParent.has(usage)) {
        const parent = graph.listParents(accessor).find((parent2) => parent2.propertyType !== "Root");
        accessorParents.set(accessor, parent);
      }
    });
    extensionsUsed.filter((extension) => extension.prewriteTypes.includes("Buffer")).forEach((extension) => extension.prewrite(context, "Buffer"));
    if ((root.listAccessors().length > 0 || context.otherBufferViews.size > 0 || root.listTextures().length > 0 && options.format === "GLB") && root.listBuffers().length === 0) throw new Error("Buffer required for Document resources, but none was found.");
    json.buffers = [];
    root.listBuffers().forEach((buffer, index) => {
      const bufferDef = context.createPropertyDef(buffer);
      const groupByParent = context.accessorUsageGroupedByParent;
      const accessors = buffer.listParents().filter((property) => property instanceof Accessor);
      const uniqueParents = new Set(accessors.map((accessor) => context.accessorParents.get(accessor)));
      const parentToIndex = new Map(Array.from(uniqueParents).map((parent, index2) => [parent, index2]));
      const accessorGroups = {};
      for (const accessor of accessors) {
        if (context.accessorIndexMap.has(accessor)) continue;
        const usage = context.getAccessorUsage(accessor);
        let key = usage;
        if (groupByParent.has(usage)) {
          const parent = context.accessorParents.get(accessor);
          key += `:${parentToIndex.get(parent)}`;
        }
        accessorGroups[key] ||= {
          usage,
          accessors: []
        };
        accessorGroups[key].accessors.push(accessor);
      }
      const buffers = [];
      const bufferIndex = json.buffers.length;
      let bufferByteLength = 0;
      for (const { usage, accessors: groupAccessors } of Object.values(accessorGroups)) if (usage === BufferViewUsage.ARRAY_BUFFER && options.vertexLayout === "interleaved") {
        const result = interleaveAccessors(groupAccessors, bufferIndex, bufferByteLength);
        bufferByteLength += result.byteLength;
        for (const buffer2 of result.buffers) buffers.push(buffer2);
      } else if (usage === BufferViewUsage.ARRAY_BUFFER) for (const accessor of groupAccessors) {
        const result = interleaveAccessors([accessor], bufferIndex, bufferByteLength);
        bufferByteLength += result.byteLength;
        for (const buffer2 of result.buffers) buffers.push(buffer2);
      }
      else if (usage === BufferViewUsage.SPARSE) {
        const result = concatSparseAccessors(groupAccessors, bufferIndex, bufferByteLength);
        bufferByteLength += result.byteLength;
        for (const buffer2 of result.buffers) buffers.push(buffer2);
      } else if (usage === BufferViewUsage.ELEMENT_ARRAY_BUFFER) {
        const target = WriterContext.BufferViewTarget.ELEMENT_ARRAY_BUFFER;
        const result = concatAccessors(groupAccessors, bufferIndex, bufferByteLength, target);
        bufferByteLength += result.byteLength;
        for (const buffer2 of result.buffers) buffers.push(buffer2);
      } else {
        const result = concatAccessors(groupAccessors, bufferIndex, bufferByteLength);
        bufferByteLength += result.byteLength;
        for (const buffer2 of result.buffers) buffers.push(buffer2);
      }
      if (context.imageBufferViews.length && index === 0) for (let i = 0; i < context.imageBufferViews.length; i++) {
        json.bufferViews[json.images[i].bufferView].byteOffset = bufferByteLength;
        bufferByteLength += context.imageBufferViews[i].byteLength;
        buffers.push(context.imageBufferViews[i]);
        if (bufferByteLength % 8) {
          const imagePadding = 8 - bufferByteLength % 8;
          bufferByteLength += imagePadding;
          buffers.push(new Uint8Array(imagePadding));
        }
      }
      if (context.otherBufferViews.has(buffer)) for (const data of context.otherBufferViews.get(buffer)) {
        json.bufferViews.push({
          buffer: bufferIndex,
          byteOffset: bufferByteLength,
          byteLength: data.byteLength
        });
        context.otherBufferViewsIndexMap.set(data, json.bufferViews.length - 1);
        bufferByteLength += data.byteLength;
        buffers.push(data);
      }
      if (bufferByteLength) {
        let uri;
        if (options.format === "GLB") uri = GLB_BUFFER;
        else {
          uri = context.bufferURIGenerator.createURI(buffer, "bin");
          bufferDef.uri = uri;
        }
        bufferDef.byteLength = bufferByteLength;
        context.assignResourceURI(uri, BufferUtils.concat(buffers), true);
      }
      json.buffers.push(bufferDef);
      context.bufferIndexMap.set(buffer, index);
    });
    if (root.listAccessors().find((a) => !a.getBuffer())) logger.warn("Skipped writing one or more Accessors: no Buffer assigned.");
    extensionsUsed.filter((extension) => extension.prewriteTypes.includes("Material")).forEach((extension) => extension.prewrite(context, "Material"));
    json.materials = root.listMaterials().map((material, index) => {
      const materialDef = context.createPropertyDef(material);
      if (material.getAlphaMode() !== Material.AlphaMode.OPAQUE) materialDef.alphaMode = material.getAlphaMode();
      if (material.getAlphaMode() === Material.AlphaMode.MASK) materialDef.alphaCutoff = material.getAlphaCutoff();
      if (material.getDoubleSided()) materialDef.doubleSided = true;
      materialDef.pbrMetallicRoughness = {};
      if (!MathUtils.eq(material.getBaseColorFactor(), [
        1,
        1,
        1,
        1
      ])) materialDef.pbrMetallicRoughness.baseColorFactor = material.getBaseColorFactor();
      if (!MathUtils.eq(material.getEmissiveFactor(), [
        0,
        0,
        0
      ])) materialDef.emissiveFactor = material.getEmissiveFactor();
      if (material.getRoughnessFactor() !== 1) materialDef.pbrMetallicRoughness.roughnessFactor = material.getRoughnessFactor();
      if (material.getMetallicFactor() !== 1) materialDef.pbrMetallicRoughness.metallicFactor = material.getMetallicFactor();
      if (material.getBaseColorTexture()) {
        const texture = material.getBaseColorTexture();
        const textureInfo = material.getBaseColorTextureInfo();
        materialDef.pbrMetallicRoughness.baseColorTexture = context.createTextureInfoDef(texture, textureInfo);
      }
      if (material.getEmissiveTexture()) {
        const texture = material.getEmissiveTexture();
        const textureInfo = material.getEmissiveTextureInfo();
        materialDef.emissiveTexture = context.createTextureInfoDef(texture, textureInfo);
      }
      if (material.getNormalTexture()) {
        const texture = material.getNormalTexture();
        const textureInfo = material.getNormalTextureInfo();
        const textureInfoDef = context.createTextureInfoDef(texture, textureInfo);
        if (material.getNormalScale() !== 1) textureInfoDef.scale = material.getNormalScale();
        materialDef.normalTexture = textureInfoDef;
      }
      if (material.getOcclusionTexture()) {
        const texture = material.getOcclusionTexture();
        const textureInfo = material.getOcclusionTextureInfo();
        const textureInfoDef = context.createTextureInfoDef(texture, textureInfo);
        if (material.getOcclusionStrength() !== 1) textureInfoDef.strength = material.getOcclusionStrength();
        materialDef.occlusionTexture = textureInfoDef;
      }
      if (material.getMetallicRoughnessTexture()) {
        const texture = material.getMetallicRoughnessTexture();
        const textureInfo = material.getMetallicRoughnessTextureInfo();
        materialDef.pbrMetallicRoughness.metallicRoughnessTexture = context.createTextureInfoDef(texture, textureInfo);
      }
      context.materialIndexMap.set(material, index);
      return materialDef;
    });
    extensionsUsed.filter((extension) => extension.prewriteTypes.includes("Mesh")).forEach((extension) => extension.prewrite(context, "Mesh"));
    json.meshes = root.listMeshes().map((mesh, index) => {
      const meshDef = context.createPropertyDef(mesh);
      let targetNames = null;
      meshDef.primitives = mesh.listPrimitives().map((primitive) => {
        const primitiveDef = { attributes: {} };
        primitiveDef.mode = primitive.getMode();
        const material = primitive.getMaterial();
        if (material) primitiveDef.material = context.materialIndexMap.get(material);
        if (Object.keys(primitive.getExtras()).length) primitiveDef.extras = primitive.getExtras();
        const indices = primitive.getIndices();
        if (indices) primitiveDef.indices = context.accessorIndexMap.get(indices);
        for (const semantic of primitive.listSemantics()) primitiveDef.attributes[semantic] = context.accessorIndexMap.get(primitive.getAttribute(semantic));
        for (const target of primitive.listTargets()) {
          const targetDef = {};
          for (const semantic of target.listSemantics()) targetDef[semantic] = context.accessorIndexMap.get(target.getAttribute(semantic));
          primitiveDef.targets = primitiveDef.targets || [];
          primitiveDef.targets.push(targetDef);
        }
        if (primitive.listTargets().length && !targetNames) targetNames = primitive.listTargets().map((target) => target.getName());
        return primitiveDef;
      });
      if (mesh.getWeights().length) meshDef.weights = mesh.getWeights();
      if (targetNames) {
        meshDef.extras = meshDef.extras || {};
        meshDef.extras["targetNames"] = targetNames;
      }
      context.meshIndexMap.set(mesh, index);
      return meshDef;
    });
    json.cameras = root.listCameras().map((camera, index) => {
      const cameraDef = context.createPropertyDef(camera);
      cameraDef.type = camera.getType();
      if (cameraDef.type === Camera.Type.PERSPECTIVE) {
        cameraDef.perspective = {
          znear: camera.getZNear(),
          zfar: camera.getZFar(),
          yfov: camera.getYFov()
        };
        const aspectRatio = camera.getAspectRatio();
        if (aspectRatio !== null) cameraDef.perspective.aspectRatio = aspectRatio;
      } else cameraDef.orthographic = {
        znear: camera.getZNear(),
        zfar: camera.getZFar(),
        xmag: camera.getXMag(),
        ymag: camera.getYMag()
      };
      context.cameraIndexMap.set(camera, index);
      return cameraDef;
    });
    json.nodes = root.listNodes().map((node, index) => {
      const nodeDef = context.createPropertyDef(node);
      if (!MathUtils.eq(node.getTranslation(), [
        0,
        0,
        0
      ])) nodeDef.translation = node.getTranslation();
      if (!MathUtils.eq(node.getRotation(), [
        0,
        0,
        0,
        1
      ])) nodeDef.rotation = node.getRotation();
      if (!MathUtils.eq(node.getScale(), [
        1,
        1,
        1
      ])) nodeDef.scale = node.getScale();
      if (node.getWeights().length) nodeDef.weights = node.getWeights();
      context.nodeIndexMap.set(node, index);
      return nodeDef;
    });
    json.skins = root.listSkins().map((skin, index) => {
      const skinDef = context.createPropertyDef(skin);
      const inverseBindMatrices = skin.getInverseBindMatrices();
      if (inverseBindMatrices) skinDef.inverseBindMatrices = context.accessorIndexMap.get(inverseBindMatrices);
      const skeleton = skin.getSkeleton();
      if (skeleton) skinDef.skeleton = context.nodeIndexMap.get(skeleton);
      skinDef.joints = skin.listJoints().map((joint) => context.nodeIndexMap.get(joint));
      context.skinIndexMap.set(skin, index);
      return skinDef;
    });
    root.listNodes().forEach((node, index) => {
      const nodeDef = json.nodes[index];
      const mesh = node.getMesh();
      if (mesh) nodeDef.mesh = context.meshIndexMap.get(mesh);
      const camera = node.getCamera();
      if (camera) nodeDef.camera = context.cameraIndexMap.get(camera);
      const skin = node.getSkin();
      if (skin) nodeDef.skin = context.skinIndexMap.get(skin);
      if (node.listChildren().length > 0) nodeDef.children = node.listChildren().map((node2) => context.nodeIndexMap.get(node2));
    });
    json.animations = root.listAnimations().map((animation, index) => {
      const animationDef = context.createPropertyDef(animation);
      const samplerIndexMap = /* @__PURE__ */ new Map();
      animationDef.samplers = animation.listSamplers().map((sampler, samplerIndex) => {
        const samplerDef = context.createPropertyDef(sampler);
        samplerDef.input = context.accessorIndexMap.get(sampler.getInput());
        samplerDef.output = context.accessorIndexMap.get(sampler.getOutput());
        samplerDef.interpolation = sampler.getInterpolation();
        samplerIndexMap.set(sampler, samplerIndex);
        return samplerDef;
      });
      animationDef.channels = animation.listChannels().map((channel) => {
        const channelDef = context.createPropertyDef(channel);
        channelDef.sampler = samplerIndexMap.get(channel.getSampler());
        channelDef.target = {
          node: context.nodeIndexMap.get(channel.getTargetNode()),
          path: channel.getTargetPath()
        };
        return channelDef;
      });
      context.animationIndexMap.set(animation, index);
      return animationDef;
    });
    json.scenes = root.listScenes().map((scene, index) => {
      const sceneDef = context.createPropertyDef(scene);
      sceneDef.nodes = scene.listChildren().map((node) => context.nodeIndexMap.get(node));
      context.sceneIndexMap.set(scene, index);
      return sceneDef;
    });
    const defaultScene = root.getDefaultScene();
    if (defaultScene) json.scene = root.listScenes().indexOf(defaultScene);
    json.extensionsUsed = extensionsUsed.map((ext) => ext.extensionName);
    json.extensionsRequired = extensionsRequired.map((ext) => ext.extensionName);
    extensionsUsed.forEach((extension) => extension.write(context));
    clean(json);
    return jsonDoc;
  }
};
function clean(object2) {
  const unused = [];
  for (const key in object2) {
    const value = object2[key];
    if (Array.isArray(value) && value.length === 0) unused.push(key);
    else if (value === null || value === "") unused.push(key);
    else if (value && typeof value === "object" && Object.keys(value).length === 0) unused.push(key);
  }
  for (const key of unused) delete object2[key];
}
var PlatformIO = class {
  _logger = Logger.DEFAULT_INSTANCE;
  _extensions = /* @__PURE__ */ new Set();
  _dependencies = {};
  _vertexLayout = "interleaved";
  _strictResources = true;
  /** @hidden */
  lastReadBytes = 0;
  /** @hidden */
  lastWriteBytes = 0;
  /** Sets the {@link Logger} used by this I/O instance. Defaults to Logger.DEFAULT_INSTANCE. */
  setLogger(logger) {
    this._logger = logger;
    return this;
  }
  /** Registers extensions, enabling I/O class to read and write glTF assets requiring them. */
  registerExtensions(extensions) {
    for (const extension of extensions) {
      this._extensions.add(extension);
      extension.register();
    }
    return this;
  }
  /** Registers dependencies used (e.g. by extensions) in the I/O process. */
  registerDependencies(dependencies) {
    Object.assign(this._dependencies, dependencies);
    return this;
  }
  /**
  * Sets the vertex layout method used by this I/O instance. Defaults to
  * VertexLayout.INTERLEAVED.
  */
  setVertexLayout(layout) {
    this._vertexLayout = layout;
    return this;
  }
  /**
  * Sets whether missing external resources should throw errors (strict mode) or
  * be ignored with warnings. Missing images can be ignored, but missing buffers
  * will currently always result in an error. When strict mode is disabled and
  * missing resources are encountered, the resulting {@link Document} will be
  * created in an invalid state. Manual fixes to the Document may be necessary,
  * resolving null images in {@link Texture Textures} or removing the affected
  * Textures, before the Document can be written to output or used in transforms.
  *
  * Defaults to true (strict mode).
  */
  setStrictResources(strict) {
    this._strictResources = strict;
    return this;
  }
  /**********************************************************************************************
  * Public Read API.
  */
  /** Reads a {@link Document} from the given URI. */
  async read(uri) {
    return await this.readJSON(await this.readAsJSON(uri));
  }
  /** Loads a URI and returns a {@link JSONDocument} struct, without parsing. */
  async readAsJSON(uri) {
    const view = await this.readURI(uri, "view");
    this.lastReadBytes = view.byteLength;
    const jsonDoc = isGLB(view) ? this._binaryToJSON(view) : {
      json: JSON.parse(BufferUtils.decodeText(view)),
      resources: {}
    };
    await this._readResourcesExternal(jsonDoc, this.dirname(uri));
    this._readResourcesInternal(jsonDoc);
    return jsonDoc;
  }
  /** Converts glTF-formatted JSON and a resource map to a {@link Document}. */
  async readJSON(jsonDoc) {
    jsonDoc = this._copyJSON(jsonDoc);
    this._readResourcesInternal(jsonDoc);
    return GLTFReader.read(jsonDoc, {
      extensions: Array.from(this._extensions),
      dependencies: this._dependencies,
      logger: this._logger
    });
  }
  /** Converts a GLB-formatted Uint8Array to a {@link JSONDocument}. */
  async binaryToJSON(glb) {
    const jsonDoc = this._binaryToJSON(BufferUtils.assertView(glb));
    this._readResourcesInternal(jsonDoc);
    const json = jsonDoc.json;
    if (json.buffers && json.buffers.some((bufferDef) => isExternalBuffer(jsonDoc, bufferDef))) throw new Error("Cannot resolve external buffers with binaryToJSON().");
    else if (json.images && json.images.some((imageDef) => isExternalImage(jsonDoc, imageDef))) throw new Error("Cannot resolve external images with binaryToJSON().");
    return jsonDoc;
  }
  /** Converts a GLB-formatted Uint8Array to a {@link Document}. */
  async readBinary(glb) {
    return this.readJSON(await this.binaryToJSON(BufferUtils.assertView(glb)));
  }
  /**********************************************************************************************
  * Public Write API.
  */
  /** Converts a {@link Document} to glTF-formatted JSON and a resource map. */
  async writeJSON(doc, _options = {}) {
    if (_options.format === "GLB" && doc.getRoot().listBuffers().length > 1) throw new Error("GLB must have 0\u20131 buffers.");
    return GLTFWriter.write(doc, {
      format: _options.format || "GLTF",
      basename: _options.basename || "",
      logger: this._logger,
      vertexLayout: this._vertexLayout,
      dependencies: { ...this._dependencies },
      extensions: Array.from(this._extensions)
    });
  }
  /** Converts a {@link Document} to a GLB-formatted Uint8Array. */
  async writeBinary(doc) {
    const { json, resources } = await this.writeJSON(doc, { format: "GLB" });
    const header = new Uint32Array([
      1179937895,
      2,
      12
    ]);
    const jsonText = JSON.stringify(json);
    const jsonChunkData = BufferUtils.pad(BufferUtils.encodeText(jsonText), 32);
    const jsonChunkHeader = BufferUtils.toView(new Uint32Array([jsonChunkData.byteLength, 1313821514]));
    const jsonChunk = BufferUtils.concat([jsonChunkHeader, jsonChunkData]);
    header[header.length - 1] += jsonChunk.byteLength;
    const binBuffer = Object.values(resources)[0];
    if (!binBuffer || !binBuffer.byteLength) return BufferUtils.concat([BufferUtils.toView(header), jsonChunk]);
    const binChunkData = BufferUtils.pad(binBuffer, 0);
    const binChunkHeader = BufferUtils.toView(new Uint32Array([binChunkData.byteLength, 5130562]));
    const binChunk = BufferUtils.concat([binChunkHeader, binChunkData]);
    header[header.length - 1] += binChunk.byteLength;
    return BufferUtils.concat([
      BufferUtils.toView(header),
      jsonChunk,
      binChunk
    ]);
  }
  /**********************************************************************************************
  * Internal.
  */
  async _readResourcesExternal(jsonDoc, base) {
    const images = jsonDoc.json.images || [];
    const buffers = jsonDoc.json.buffers || [];
    const pendingResources = [...images, ...buffers].map(async (resource) => {
      const uri = resource.uri;
      if (!uri || uri.match(/data:/)) return Promise.resolve();
      try {
        jsonDoc.resources[uri] = await this.readURI(this.resolve(base, uri), "view");
        this.lastReadBytes += jsonDoc.resources[uri].byteLength;
      } catch (error) {
        if (!this._strictResources && images.includes(resource)) {
          this._logger.warn(`Failed to load image URI, "${uri}". ${error}`);
          jsonDoc.resources[uri] = null;
        } else throw error;
      }
    });
    await Promise.all(pendingResources);
  }
  _readResourcesInternal(jsonDoc) {
    function resolveResource(resource) {
      if (!resource.uri) return;
      if (resource.uri in jsonDoc.resources) {
        BufferUtils.assertView(jsonDoc.resources[resource.uri]);
        return;
      }
      if (resource.uri.match(/data:/)) {
        const resourceUUID = `__${uuid()}.${FileUtils.extension(resource.uri)}`;
        jsonDoc.resources[resourceUUID] = BufferUtils.createBufferFromDataURI(resource.uri);
        resource.uri = resourceUUID;
      }
    }
    (jsonDoc.json.images || []).forEach((image) => {
      if (image.bufferView === void 0 && image.uri === void 0) throw new Error("Missing resource URI or buffer view.");
      resolveResource(image);
    });
    (jsonDoc.json.buffers || []).forEach(resolveResource);
  }
  /**
  * Creates a shallow copy of glTF-formatted {@link JSONDocument}.
  *
  * Images, Buffers, and Resources objects are deep copies so that PlatformIO can safely
  * modify them during the parsing process. Other properties are shallow copies, and buffers
  * are passed by reference.
  */
  _copyJSON(jsonDoc) {
    const { images, buffers } = jsonDoc.json;
    jsonDoc = {
      json: { ...jsonDoc.json },
      resources: { ...jsonDoc.resources }
    };
    if (images) jsonDoc.json.images = images.map((image) => ({ ...image }));
    if (buffers) jsonDoc.json.buffers = buffers.map((buffer) => ({ ...buffer }));
    return jsonDoc;
  }
  /** Internal version of binaryToJSON; does not warn about external resources. */
  _binaryToJSON(glb) {
    if (!isGLB(glb)) throw new Error("Invalid glTF 2.0 binary.");
    const jsonChunkHeader = new Uint32Array(glb.buffer, glb.byteOffset + 12, 2);
    if (jsonChunkHeader[1] !== 1313821514) throw new Error("Missing required GLB JSON chunk.");
    const jsonByteOffset = 20;
    const jsonByteLength = jsonChunkHeader[0];
    const jsonText = BufferUtils.decodeText(BufferUtils.toView(glb, jsonByteOffset, jsonByteLength));
    const json = JSON.parse(jsonText);
    const binByteOffset = jsonByteOffset + jsonByteLength;
    if (glb.byteLength <= binByteOffset) return {
      json,
      resources: {}
    };
    const binChunkHeader = new Uint32Array(glb.buffer, glb.byteOffset + binByteOffset, 2);
    if (binChunkHeader[1] !== 5130562) return {
      json,
      resources: {}
    };
    const binByteLength = binChunkHeader[0];
    const binBuffer = BufferUtils.toView(glb, binByteOffset + 8, binByteLength);
    return {
      json,
      resources: { [GLB_BUFFER]: binBuffer }
    };
  }
};
function isExternalBuffer(jsonDocument, bufferDef) {
  return bufferDef.uri !== void 0 && !(bufferDef.uri in jsonDocument.resources);
}
function isExternalImage(jsonDocument, imageDef) {
  return imageDef.uri !== void 0 && !(imageDef.uri in jsonDocument.resources) && imageDef.bufferView === void 0;
}
function isGLB(view) {
  if (view.byteLength < 3 * Uint32Array.BYTES_PER_ELEMENT) return false;
  const header = new Uint32Array(view.buffer, view.byteOffset, 3);
  return header[0] === 1179937895 && header[1] === 2;
}
var NodeIO = class extends PlatformIO {
  _fetch;
  _fetchConfig;
  _init;
  _fetchEnabled = false;
  /**
  * Constructs a new NodeIO service. Instances are reusable. By default, only NodeIO can only
  * read/write paths on disk. To enable HTTP requests, provide a Fetch API implementation and
  * enable {@link NodeIO.setAllowNetwork setAllowNetwork}.
  *
  * @param fetch Implementation of Fetch API.
  * @param fetchConfig Configuration object for Fetch API.
  */
  constructor(_fetch = null, _fetchConfig = HTTPUtils.DEFAULT_INIT) {
    super();
    this._fetch = _fetch;
    this._fetchConfig = _fetchConfig;
    this._init = this.init();
  }
  async init() {
    if (this._init) return this._init;
    return Promise.all([import("node:fs"), import("node:path")]).then(([fs, path2]) => {
      this._fs = fs.promises;
      this._path = path2;
    });
  }
  setAllowNetwork(allow) {
    if (allow && !this._fetch) throw new Error("NodeIO requires a Fetch API implementation for HTTP requests.");
    this._fetchEnabled = allow;
    return this;
  }
  async readURI(uri, type) {
    await this.init();
    if (HTTPUtils.isAbsoluteURL(uri)) {
      if (!this._fetchEnabled || !this._fetch) throw new Error("Network request blocked. Allow HTTP requests explicitly, if needed.");
      const response = await this._fetch(uri, this._fetchConfig);
      switch (type) {
        case "view":
          return new Uint8Array(await response.arrayBuffer());
        case "text":
          return response.text();
      }
    } else switch (type) {
      case "view":
        return this._fs.readFile(uri);
      case "text":
        return this._fs.readFile(uri, "utf8");
    }
  }
  resolve(base, path2) {
    if (HTTPUtils.isAbsoluteURL(base) || HTTPUtils.isAbsoluteURL(path2)) return HTTPUtils.resolve(base, path2);
    return this._path.resolve(base, decodeURIComponent(path2));
  }
  dirname(uri) {
    if (HTTPUtils.isAbsoluteURL(uri)) return HTTPUtils.dirname(uri);
    return this._path.dirname(uri);
  }
  /**********************************************************************************************
  * Public.
  */
  /** Writes a {@link Document} instance to a local path. */
  async write(uri, doc) {
    await this.init();
    await (!!uri.match(/\.glb$/) ? this._writeGLB(uri, doc) : this._writeGLTF(uri, doc));
  }
  /**********************************************************************************************
  * Private.
  */
  /** @internal */
  async _writeGLTF(uri, doc) {
    this.lastWriteBytes = 0;
    const { json, resources } = await this.writeJSON(doc, {
      format: "GLTF",
      basename: FileUtils.basename(uri)
    });
    const { _fs: fs, _path: path2 } = this;
    const dir = path2.dirname(uri);
    const jsonContent = JSON.stringify(json, null, 2);
    await fs.writeFile(uri, jsonContent);
    this.lastWriteBytes += jsonContent.length;
    for (const batch of listBatches(Object.keys(resources), 10)) await Promise.all(batch.map(async (resourceURI) => {
      if (HTTPUtils.isAbsoluteURL(resourceURI)) {
        if (HTTPUtils.extension(resourceURI) === "bin") throw new Error(`Cannot write buffer to path "${resourceURI}".`);
        return;
      }
      const resourcePath = path2.join(dir, decodeURIComponent(resourceURI));
      await fs.mkdir(path2.dirname(resourcePath), { recursive: true });
      await fs.writeFile(resourcePath, resources[resourceURI]);
      this.lastWriteBytes += resources[resourceURI].byteLength;
    }));
  }
  /** @internal */
  async _writeGLB(uri, doc) {
    const buffer = await this.writeBinary(doc);
    await this._fs.writeFile(uri, buffer);
    this.lastWriteBytes = buffer.byteLength;
  }
};
function listBatches(array, batchSize) {
  const batches = [];
  for (let i = 0, il = array.length; i < il; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < il; j++) batch.push(array[i + j]);
    batches.push(batch);
  }
  return batches;
}

// node_modules/ktx-parse/dist/ktx-parse.modern.js
var KHR_SUPERCOMPRESSION_NONE = 0;
var KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT = 0;
var KHR_DF_VENDORID_KHRONOS = 0;
var KHR_DF_VERSION = 2;
var KHR_DF_MODEL_UNSPECIFIED = 0;
var KHR_DF_MODEL_ETC1S = 163;
var KHR_DF_MODEL_UASTC = 166;
var KHR_DF_FLAG_ALPHA_STRAIGHT = 0;
var KHR_DF_TRANSFER_SRGB = 2;
var KHR_DF_PRIMARIES_BT709 = 1;
var KHR_DF_SAMPLE_DATATYPE_SIGNED = 64;
var VK_FORMAT_UNDEFINED = 0;
var VK_FORMAT_E5B9G9R9_UFLOAT_PACK32 = 123;
var VK_FORMAT_ASTC_4x4_SFLOAT_BLOCK_EXT = 1000066e3;
function createDefaultContainer() {
  return {
    vkFormat: VK_FORMAT_UNDEFINED,
    typeSize: 1,
    pixelWidth: 0,
    pixelHeight: 0,
    pixelDepth: 0,
    layerCount: 0,
    faceCount: 1,
    levelCount: 0,
    supercompressionScheme: KHR_SUPERCOMPRESSION_NONE,
    levels: [],
    dataFormatDescriptor: [{
      vendorId: KHR_DF_VENDORID_KHRONOS,
      descriptorType: KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT,
      versionNumber: KHR_DF_VERSION,
      colorModel: KHR_DF_MODEL_UNSPECIFIED,
      colorPrimaries: KHR_DF_PRIMARIES_BT709,
      transferFunction: KHR_DF_TRANSFER_SRGB,
      flags: KHR_DF_FLAG_ALPHA_STRAIGHT,
      texelBlockDimension: [0, 0, 0, 0],
      bytesPlane: [0, 0, 0, 0, 0, 0, 0, 0],
      samples: []
    }],
    keyValue: {},
    globalData: null
  };
}
var BufferReader = class {
  constructor(data, byteOffset, byteLength, littleEndian) {
    this._dataView = void 0;
    this._littleEndian = void 0;
    this._offset = void 0;
    this._dataView = new DataView(data.buffer, data.byteOffset + byteOffset, byteLength);
    this._littleEndian = littleEndian;
    this._offset = 0;
  }
  _nextUint8() {
    const value = this._dataView.getUint8(this._offset);
    this._offset += 1;
    return value;
  }
  _nextUint16() {
    const value = this._dataView.getUint16(this._offset, this._littleEndian);
    this._offset += 2;
    return value;
  }
  _nextUint32() {
    const value = this._dataView.getUint32(this._offset, this._littleEndian);
    this._offset += 4;
    return value;
  }
  _nextUint64() {
    const left = this._dataView.getUint32(this._offset, this._littleEndian);
    const right = this._dataView.getUint32(this._offset + 4, this._littleEndian);
    const value = left + 2 ** 32 * right;
    this._offset += 8;
    return value;
  }
  _nextInt32() {
    const value = this._dataView.getInt32(this._offset, this._littleEndian);
    this._offset += 4;
    return value;
  }
  _nextUint8Array(len) {
    const value = new Uint8Array(this._dataView.buffer, this._dataView.byteOffset + this._offset, len);
    this._offset += len;
    return value;
  }
  _skip(bytes) {
    this._offset += bytes;
    return this;
  }
  _scan(maxByteLength, term = 0) {
    const byteOffset = this._offset;
    let byteLength = 0;
    while (this._dataView.getUint8(this._offset) !== term && byteLength < maxByteLength) {
      byteLength++;
      this._offset++;
    }
    if (byteLength < maxByteLength) this._offset++;
    return new Uint8Array(this._dataView.buffer, this._dataView.byteOffset + byteOffset, byteLength);
  }
};
var NUL = new Uint8Array([0]);
var KTX2_ID = [
  // '´', 'K', 'T', 'X', '2', '0', 'ª', '\r', '\n', '\x1A', '\n'
  171,
  75,
  84,
  88,
  32,
  50,
  48,
  187,
  13,
  10,
  26,
  10
];
function decodeText(buffer) {
  return new TextDecoder().decode(buffer);
}
function read(data) {
  const id = new Uint8Array(data.buffer, data.byteOffset, KTX2_ID.length);
  if (id[0] !== KTX2_ID[0] || // '´'
  id[1] !== KTX2_ID[1] || // 'K'
  id[2] !== KTX2_ID[2] || // 'T'
  id[3] !== KTX2_ID[3] || // 'X'
  id[4] !== KTX2_ID[4] || // ' '
  id[5] !== KTX2_ID[5] || // '2'
  id[6] !== KTX2_ID[6] || // '0'
  id[7] !== KTX2_ID[7] || // 'ª'
  id[8] !== KTX2_ID[8] || // '\r'
  id[9] !== KTX2_ID[9] || // '\n'
  id[10] !== KTX2_ID[10] || // '\x1A'
  id[11] !== KTX2_ID[11]) {
    throw new Error("Missing KTX 2.0 identifier.");
  }
  const container = createDefaultContainer();
  const headerByteLength = 17 * Uint32Array.BYTES_PER_ELEMENT;
  const headerReader = new BufferReader(data, KTX2_ID.length, headerByteLength, true);
  container.vkFormat = headerReader._nextUint32();
  container.typeSize = headerReader._nextUint32();
  container.pixelWidth = headerReader._nextUint32();
  container.pixelHeight = headerReader._nextUint32();
  container.pixelDepth = headerReader._nextUint32();
  container.layerCount = headerReader._nextUint32();
  container.faceCount = headerReader._nextUint32();
  container.levelCount = headerReader._nextUint32();
  container.supercompressionScheme = headerReader._nextUint32();
  const dfdByteOffset = headerReader._nextUint32();
  const dfdByteLength = headerReader._nextUint32();
  const kvdByteOffset = headerReader._nextUint32();
  const kvdByteLength = headerReader._nextUint32();
  const sgdByteOffset = headerReader._nextUint64();
  const sgdByteLength = headerReader._nextUint64();
  const levelByteLength = Math.max(container.levelCount, 1) * 3 * 8;
  const levelReader = new BufferReader(data, KTX2_ID.length + headerByteLength, levelByteLength, true);
  for (let i = 0, il = Math.max(container.levelCount, 1); i < il; i++) {
    container.levels.push({
      levelData: new Uint8Array(data.buffer, data.byteOffset + levelReader._nextUint64(), levelReader._nextUint64()),
      uncompressedByteLength: levelReader._nextUint64()
    });
  }
  const dfdReader = new BufferReader(data, dfdByteOffset, dfdByteLength, true);
  dfdReader._skip(4);
  const vendorId = dfdReader._nextUint16();
  const descriptorType = dfdReader._nextUint16();
  const versionNumber = dfdReader._nextUint16();
  const descriptorBlockSize = dfdReader._nextUint16();
  const colorModel = dfdReader._nextUint8();
  const colorPrimaries = dfdReader._nextUint8();
  const transferFunction = dfdReader._nextUint8();
  const flags = dfdReader._nextUint8();
  const texelBlockDimension = [dfdReader._nextUint8(), dfdReader._nextUint8(), dfdReader._nextUint8(), dfdReader._nextUint8()];
  const bytesPlane = [dfdReader._nextUint8(), dfdReader._nextUint8(), dfdReader._nextUint8(), dfdReader._nextUint8(), dfdReader._nextUint8(), dfdReader._nextUint8(), dfdReader._nextUint8(), dfdReader._nextUint8()];
  const samples = [];
  const dfd = {
    vendorId,
    descriptorType,
    versionNumber,
    colorModel,
    colorPrimaries,
    transferFunction,
    flags,
    texelBlockDimension,
    bytesPlane,
    samples
  };
  const sampleStart = 6;
  const sampleWords = 4;
  const numSamples = (descriptorBlockSize / 4 - sampleStart) / sampleWords;
  for (let i = 0; i < numSamples; i++) {
    const sample = {
      bitOffset: dfdReader._nextUint16(),
      bitLength: dfdReader._nextUint8(),
      channelType: dfdReader._nextUint8(),
      samplePosition: [dfdReader._nextUint8(), dfdReader._nextUint8(), dfdReader._nextUint8(), dfdReader._nextUint8()],
      sampleLower: Number.NEGATIVE_INFINITY,
      sampleUpper: Number.POSITIVE_INFINITY
    };
    if (sample.channelType & KHR_DF_SAMPLE_DATATYPE_SIGNED) {
      sample.sampleLower = dfdReader._nextInt32();
      sample.sampleUpper = dfdReader._nextInt32();
    } else {
      sample.sampleLower = dfdReader._nextUint32();
      sample.sampleUpper = dfdReader._nextUint32();
    }
    dfd.samples[i] = sample;
  }
  container.dataFormatDescriptor.length = 0;
  container.dataFormatDescriptor.push(dfd);
  const kvdReader = new BufferReader(data, kvdByteOffset, kvdByteLength, true);
  while (kvdReader._offset < kvdByteLength) {
    const keyValueByteLength = kvdReader._nextUint32();
    const keyData = kvdReader._scan(keyValueByteLength);
    const key = decodeText(keyData);
    container.keyValue[key] = kvdReader._nextUint8Array(keyValueByteLength - keyData.byteLength - 1);
    if (key.match(/^ktx/i)) {
      const text = decodeText(container.keyValue[key]);
      container.keyValue[key] = text.substring(0, text.lastIndexOf("\0"));
    }
    const kvPadding = keyValueByteLength % 4 ? 4 - keyValueByteLength % 4 : 0;
    kvdReader._skip(kvPadding);
  }
  if (sgdByteLength <= 0) return container;
  const sgdReader = new BufferReader(data, sgdByteOffset, sgdByteLength, true);
  const endpointCount = sgdReader._nextUint16();
  const selectorCount = sgdReader._nextUint16();
  const endpointsByteLength = sgdReader._nextUint32();
  const selectorsByteLength = sgdReader._nextUint32();
  const tablesByteLength = sgdReader._nextUint32();
  const extendedByteLength = sgdReader._nextUint32();
  const imageDescs = [];
  for (let i = 0, il = Math.max(container.levelCount, 1); i < il; i++) {
    imageDescs.push({
      imageFlags: sgdReader._nextUint32(),
      rgbSliceByteOffset: sgdReader._nextUint32(),
      rgbSliceByteLength: sgdReader._nextUint32(),
      alphaSliceByteOffset: sgdReader._nextUint32(),
      alphaSliceByteLength: sgdReader._nextUint32()
    });
  }
  const endpointsByteOffset = sgdByteOffset + sgdReader._offset;
  const selectorsByteOffset = endpointsByteOffset + endpointsByteLength;
  const tablesByteOffset = selectorsByteOffset + selectorsByteLength;
  const extendedByteOffset = tablesByteOffset + tablesByteLength;
  const endpointsData = new Uint8Array(data.buffer, data.byteOffset + endpointsByteOffset, endpointsByteLength);
  const selectorsData = new Uint8Array(data.buffer, data.byteOffset + selectorsByteOffset, selectorsByteLength);
  const tablesData = new Uint8Array(data.buffer, data.byteOffset + tablesByteOffset, tablesByteLength);
  const extendedData = new Uint8Array(data.buffer, data.byteOffset + extendedByteOffset, extendedByteLength);
  container.globalData = {
    endpointCount,
    selectorCount,
    imageDescs,
    endpointsData,
    selectorsData,
    tablesData,
    extendedData
  };
  return container;
}

// node_modules/@gltf-transform/extensions/dist/index.js
var EXT_MESH_GPU_INSTANCING = "EXT_mesh_gpu_instancing";
var EXT_MESH_FEATURES = "EXT_mesh_features";
var EXT_MESHOPT_COMPRESSION = "EXT_meshopt_compression";
var EXT_STRUCTURAL_METADATA = "EXT_structural_metadata";
var EXT_TEXTURE_WEBP = "EXT_texture_webp";
var EXT_TEXTURE_AVIF = "EXT_texture_avif";
var KHR_ACCESSOR_FLOAT16 = "KHR_accessor_float16";
var KHR_ACCESSOR_FLOAT64 = "KHR_accessor_float64";
var KHR_DRACO_MESH_COMPRESSION = "KHR_draco_mesh_compression";
var KHR_LIGHTS_PUNCTUAL = "KHR_lights_punctual";
var KHR_MATERIALS_ANISOTROPY = "KHR_materials_anisotropy";
var KHR_MATERIALS_CLEARCOAT = "KHR_materials_clearcoat";
var KHR_MATERIALS_DIFFUSE_TRANSMISSION = "KHR_materials_diffuse_transmission";
var KHR_MATERIALS_DISPERSION = "KHR_materials_dispersion";
var KHR_MATERIALS_EMISSIVE_STRENGTH = "KHR_materials_emissive_strength";
var KHR_MATERIALS_IOR = "KHR_materials_ior";
var KHR_MATERIALS_IRIDESCENCE = "KHR_materials_iridescence";
var KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS = "KHR_materials_pbrSpecularGlossiness";
var KHR_MATERIALS_SHEEN = "KHR_materials_sheen";
var KHR_MATERIALS_SPECULAR = "KHR_materials_specular";
var KHR_MATERIALS_TRANSMISSION = "KHR_materials_transmission";
var KHR_MATERIALS_UNLIT = "KHR_materials_unlit";
var KHR_MATERIALS_VOLUME = "KHR_materials_volume";
var KHR_MATERIALS_VARIANTS = "KHR_materials_variants";
var KHR_MESH_PRIMITIVE_RESTART = "KHR_mesh_primitive_restart";
var KHR_MESH_QUANTIZATION = "KHR_mesh_quantization";
var KHR_NODE_VISIBILITY = "KHR_node_visibility";
var KHR_TEXTURE_BASISU = "KHR_texture_basisu";
var KHR_TEXTURE_TRANSFORM = "KHR_texture_transform";
var KHR_XMP_JSON_LD = "KHR_xmp_json_ld";
var FeatureID = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_MESH_FEATURES;
  init() {
    this.extensionName = EXT_MESH_FEATURES;
    this.propertyType = "FeatureID";
    this.parentTypes = ["Features"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      nullFeatureId: null,
      label: "",
      attribute: null,
      texture: null,
      propertyTable: null
    });
  }
  getFeatureCount() {
    return this.get("featureCount");
  }
  setFeatureCount(featureCount) {
    return this.set("featureCount", featureCount);
  }
  getNullFeatureID() {
    return this.get("nullFeatureId");
  }
  setNullFeatureID(nullFeatureId) {
    return this.set("nullFeatureId", nullFeatureId);
  }
  getLabel() {
    return this.get("label");
  }
  setLabel(label) {
    return this.set("label", label);
  }
  getAttribute() {
    return this.get("attribute");
  }
  setAttribute(attribute) {
    return this.set("attribute", attribute);
  }
  getTexture() {
    return this.getRef("texture");
  }
  setTexture(texture) {
    return this.setRef("texture", texture);
  }
  getPropertyTable() {
    return this.getRef("propertyTable");
  }
  setPropertyTable(propertyTable) {
    return this.setRef("propertyTable", propertyTable);
  }
};
var FeatureIDTexture = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_MESH_FEATURES;
  init() {
    this.extensionName = EXT_MESH_FEATURES;
    this.propertyType = "FeatureIDTexture";
    this.parentTypes = ["FeatureID"];
  }
  getDefaults() {
    const defaultTextureInfo = new TextureInfo(this.graph, "textureInfo");
    defaultTextureInfo.setMinFilter(TextureInfo.MagFilter.NEAREST);
    defaultTextureInfo.setMagFilter(TextureInfo.MagFilter.NEAREST);
    return Object.assign(super.getDefaults(), {
      channels: [0],
      texture: null,
      textureInfo: defaultTextureInfo
    });
  }
  getChannels() {
    return this.get("channels");
  }
  setChannels(channels) {
    return this.set("channels", channels);
  }
  getTexture() {
    return this.getRef("texture");
  }
  setTexture(texture) {
    return this.setRef("texture", texture);
  }
  getTextureInfo() {
    return this.getRef("texture") ? this.getRef("textureInfo") : null;
  }
};
var Features = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_MESH_FEATURES;
  init() {
    this.extensionName = EXT_MESH_FEATURES;
    this.propertyType = "Features";
    this.parentTypes = [PropertyType.PRIMITIVE];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { featureIds: new RefSet([]) });
  }
  listFeatureIDs() {
    return this.listRefs("featureIds");
  }
  addFeatureID(featureId) {
    return this.addRef("featureIds", featureId);
  }
  removeFeatureID(featureId) {
    return this.removeRef("featureIds", featureId);
  }
};
var NAME$2 = EXT_MESH_FEATURES;
var EXTMeshFeatures = class extends Extension {
  extensionName = EXT_MESH_FEATURES;
  static EXTENSION_NAME = EXT_MESH_FEATURES;
  createFeatures() {
    return new Features(this.document.getGraph());
  }
  createFeatureID() {
    return new FeatureID(this.document.getGraph());
  }
  createFeatureIDTexture() {
    return new FeatureIDTexture(this.document.getGraph());
  }
  read(context) {
    (context.jsonDoc.json.meshes || []).forEach((meshDef, meshIndex) => {
      (meshDef.primitives || []).forEach((primDef, primIndex) => {
        this._readPrimitive(context, meshIndex, primDef, primIndex);
      });
    });
    return this;
  }
  /** @hidden */
  _readPrimitive(context, meshIndex, primDef, primIndex) {
    if (!primDef.extensions || !primDef.extensions[NAME$2]) return;
    const features = this.createFeatures();
    const meshFeaturesDef = primDef.extensions[NAME$2];
    for (const featureIDDef of meshFeaturesDef.featureIds) {
      const featureID = _readFeatureID(this.document, this, context, featureIDDef);
      features.addFeatureID(featureID);
    }
    context.meshes[meshIndex].listPrimitives()[primIndex].setExtension(NAME$2, features);
  }
  write(context) {
    const meshDefs = context.jsonDoc.json.meshes;
    if (!meshDefs) return this;
    for (const mesh of this.document.getRoot().listMeshes()) {
      const meshDef = meshDefs[context.meshIndexMap.get(mesh)];
      mesh.listPrimitives().forEach((prim, primIndex) => {
        const primDef = meshDef.primitives[primIndex];
        this._writePrimitive(context, prim, primDef);
      });
    }
    return this;
  }
  /** @hidden */
  _writePrimitive(context, prim, primDef) {
    const meshFeatures = prim.getExtension(NAME$2);
    if (!meshFeatures) return;
    const meshFeaturesDef = { featureIds: [] };
    meshFeatures.listFeatureIDs().forEach((featureID) => {
      meshFeaturesDef.featureIds.push(_writeFeatureIDDef(this.document, context, featureID));
    });
    primDef.extensions = primDef.extensions || {};
    primDef.extensions[NAME$2] = meshFeaturesDef;
  }
};
function _readFeatureID(document, ext, context, featureIDDef) {
  const featureID = ext.createFeatureID().setFeatureCount(featureIDDef.featureCount);
  if (featureIDDef.nullFeatureId !== void 0) featureID.setNullFeatureID(featureIDDef.nullFeatureId);
  if (featureIDDef.label !== void 0) featureID.setLabel(featureIDDef.label);
  if (featureIDDef.attribute !== void 0) featureID.setAttribute(featureIDDef.attribute);
  const featureIDTextureDef = featureIDDef.texture;
  if (featureIDTextureDef !== void 0) {
    const featureIDTexture = _readFeatureIDTexture(ext, context, featureIDTextureDef);
    featureID.setTexture(featureIDTexture);
  }
  if (featureIDDef.propertyTable !== void 0) {
    const propertyTables = document.getRoot().getExtension(EXT_STRUCTURAL_METADATA).listPropertyTables();
    featureID.setPropertyTable(propertyTables[featureIDDef.propertyTable]);
  }
  return featureID;
}
function _readFeatureIDTexture(ext, context, featureIDTextureDef) {
  const featureIDTexture = ext.createFeatureIDTexture();
  const { json } = context.jsonDoc;
  if (featureIDTextureDef.channels) featureIDTexture.setChannels(featureIDTextureDef.channels);
  if (featureIDTextureDef.index !== void 0) {
    const textureIndex = json.textures[featureIDTextureDef.index].source;
    featureIDTexture.setTexture(context.textures[textureIndex]);
    context.setTextureInfo(featureIDTexture.getTextureInfo(), featureIDTextureDef);
  }
  return featureIDTexture;
}
function _writeFeatureIDDef(document, context, featureID) {
  const root = document.getRoot();
  const featureIDDef = { featureCount: featureID.getFeatureCount() };
  if (featureID.getNullFeatureID() != null) featureIDDef.nullFeatureId = featureID.getNullFeatureID();
  if (featureID.getLabel()) featureIDDef.label = featureID.getLabel();
  if (featureID.getAttribute() != null) featureIDDef.attribute = featureID.getAttribute();
  if (featureID.getTexture()) {
    const featureIDTexture = featureID.getTexture();
    const texture = featureIDTexture.getTexture();
    const textureInfo = featureIDTexture.getTextureInfo();
    featureIDDef.texture = context.createTextureInfoDef(texture, textureInfo);
    const channels = featureIDTexture.getChannels();
    if (!MathUtils.eq(channels, [0])) featureIDDef.texture.channels = channels;
  }
  if (featureID.getPropertyTable()) {
    const structuralMetadata = root.getExtension(EXT_STRUCTURAL_METADATA);
    const propertyTable = featureID.getPropertyTable();
    featureIDDef.propertyTable = structuralMetadata.listPropertyTables().indexOf(propertyTable);
  }
  return featureIDDef;
}
var INSTANCE_ATTRIBUTE = "INSTANCE_ATTRIBUTE";
var InstancedMesh = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_MESH_GPU_INSTANCING;
  init() {
    this.extensionName = EXT_MESH_GPU_INSTANCING;
    this.propertyType = "InstancedMesh";
    this.parentTypes = [PropertyType.NODE];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { attributes: new RefMap() });
  }
  /** Returns an instance attribute as an {@link Accessor}. */
  getAttribute(semantic) {
    return this.getRefMap("attributes", semantic);
  }
  /**
  * Sets an instance attribute to an {@link Accessor}. All attributes must have the same
  * instance count.
  */
  setAttribute(semantic, accessor) {
    return this.setRefMap("attributes", semantic, accessor, { usage: INSTANCE_ATTRIBUTE });
  }
  /**
  * Lists all instance attributes {@link Accessor}s associated with the InstancedMesh. Order
  * will be consistent with the order returned by {@link .listSemantics}().
  */
  listAttributes() {
    return this.listRefMapValues("attributes");
  }
  /**
  * Lists all instance attribute semantics associated with the primitive. Order will be
  * consistent with the order returned by {@link .listAttributes}().
  */
  listSemantics() {
    return this.listRefMapKeys("attributes");
  }
};
var EXTMeshGPUInstancing = class extends Extension {
  static EXTENSION_NAME = EXT_MESH_GPU_INSTANCING;
  extensionName = EXT_MESH_GPU_INSTANCING;
  /** @hidden */
  prewriteTypes = [PropertyType.ACCESSOR];
  /** Creates a new InstancedMesh property for use on a {@link Node}. */
  createInstancedMesh() {
    return new InstancedMesh(this.document.getGraph());
  }
  /** @hidden */
  read(context) {
    (context.jsonDoc.json.nodes || []).forEach((nodeDef, nodeIndex) => {
      if (!nodeDef.extensions || !nodeDef.extensions["EXT_mesh_gpu_instancing"]) return;
      const instancedMeshDef = nodeDef.extensions[EXT_MESH_GPU_INSTANCING];
      const instancedMesh = this.createInstancedMesh();
      for (const semantic in instancedMeshDef.attributes) instancedMesh.setAttribute(semantic, context.accessors[instancedMeshDef.attributes[semantic]]);
      context.nodes[nodeIndex].setExtension(EXT_MESH_GPU_INSTANCING, instancedMesh);
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    context.accessorUsageGroupedByParent.add(INSTANCE_ATTRIBUTE);
    for (const prop of this.properties) for (const attribute of prop.listAttributes()) context.addAccessorToUsageGroup(attribute, INSTANCE_ATTRIBUTE);
    return this;
  }
  /** @hidden */
  write(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listNodes().forEach((node) => {
      const instancedMesh = node.getExtension(EXT_MESH_GPU_INSTANCING);
      if (instancedMesh) {
        const nodeIndex = context.nodeIndexMap.get(node);
        const nodeDef = jsonDoc.json.nodes[nodeIndex];
        const instancedMeshDef = { attributes: {} };
        instancedMesh.listSemantics().forEach((semantic) => {
          const attribute = instancedMesh.getAttribute(semantic);
          instancedMeshDef.attributes[semantic] = context.accessorIndexMap.get(attribute);
        });
        nodeDef.extensions = nodeDef.extensions || {};
        nodeDef.extensions[EXT_MESH_GPU_INSTANCING] = instancedMeshDef;
      }
    });
    return this;
  }
};
var EncoderMethod$1 = /* @__PURE__ */ (function(EncoderMethod2) {
  EncoderMethod2["QUANTIZE"] = "quantize";
  EncoderMethod2["FILTER"] = "filter";
  return EncoderMethod2;
})({});
function isFallbackBuffer(bufferDef) {
  if (!bufferDef.extensions || !bufferDef.extensions["EXT_meshopt_compression"]) return false;
  return !!bufferDef.extensions[EXT_MESHOPT_COMPRESSION].fallback;
}
var { BYTE, SHORT, FLOAT } = Accessor.ComponentType;
var { encodeNormalizedInt, decodeNormalizedInt } = MathUtils;
function prepareAccessor(accessor, encoder, mode, filterOptions) {
  const { filter, bits } = filterOptions;
  const result = {
    array: accessor.getArray(),
    byteStride: accessor.getElementSize() * accessor.getComponentSize(),
    componentType: accessor.getComponentType(),
    normalized: accessor.getNormalized()
  };
  if (mode !== "ATTRIBUTES") return result;
  if (filter !== "NONE") {
    let array = accessor.getNormalized() ? decodeNormalizedIntArray(accessor) : new Float32Array(result.array);
    switch (filter) {
      case "EXPONENTIAL":
        result.byteStride = accessor.getElementSize() * 4;
        result.componentType = FLOAT;
        result.normalized = false;
        result.array = encoder.encodeFilterExp(array, accessor.getCount(), result.byteStride, bits);
        break;
      case "OCTAHEDRAL":
        result.byteStride = bits > 8 ? 8 : 4;
        result.componentType = bits > 8 ? SHORT : BYTE;
        result.normalized = true;
        array = accessor.getElementSize() === 3 ? padNormals(array) : array;
        result.array = encoder.encodeFilterOct(array, accessor.getCount(), result.byteStride, bits);
        break;
      case "QUATERNION":
        result.byteStride = 8;
        result.componentType = SHORT;
        result.normalized = true;
        result.array = encoder.encodeFilterQuat(array, accessor.getCount(), result.byteStride, bits);
        break;
      default:
        throw new Error("Invalid filter.");
    }
    result.min = accessor.getMin([]);
    result.max = accessor.getMax([]);
    if (accessor.getNormalized()) {
      result.min = result.min.map((v) => decodeNormalizedInt(v, accessor.getComponentType()));
      result.max = result.max.map((v) => decodeNormalizedInt(v, accessor.getComponentType()));
    }
    if (result.normalized) {
      result.min = result.min.map((v) => encodeNormalizedInt(v, result.componentType));
      result.max = result.max.map((v) => encodeNormalizedInt(v, result.componentType));
    }
  } else if (result.byteStride % 4) {
    result.array = padArrayElements(result.array, accessor.getElementSize());
    result.byteStride = result.array.byteLength / accessor.getCount();
  }
  return result;
}
function decodeNormalizedIntArray(attribute) {
  const componentType = attribute.getComponentType();
  const srcArray = attribute.getArray();
  const dstArray = new Float32Array(srcArray.length);
  for (let i = 0; i < srcArray.length; i++) dstArray[i] = decodeNormalizedInt(srcArray[i], componentType);
  return dstArray;
}
function padArrayElements(srcArray, elementSize) {
  const elementStride = BufferUtils.padNumber(srcArray.BYTES_PER_ELEMENT * elementSize) / srcArray.BYTES_PER_ELEMENT;
  const elementCount = srcArray.length / elementSize;
  const dstArray = new srcArray.constructor(elementCount * elementStride);
  for (let i = 0; i * elementSize < srcArray.length; i++) for (let j = 0; j < elementSize; j++) dstArray[i * elementStride + j] = srcArray[i * elementSize + j];
  return dstArray;
}
function padNormals(srcArray) {
  const dstArray = new Float32Array(srcArray.length * 4 / 3);
  for (let i = 0, il = srcArray.length / 3; i < il; i++) {
    dstArray[i * 4] = srcArray[i * 3];
    dstArray[i * 4 + 1] = srcArray[i * 3 + 1];
    dstArray[i * 4 + 2] = srcArray[i * 3 + 2];
  }
  return dstArray;
}
function getMeshoptMode(accessor, usage) {
  if (usage === WriterContext.BufferViewUsage.ELEMENT_ARRAY_BUFFER) return accessor.listParents().some((parent) => {
    return parent instanceof Primitive && parent.getMode() === Primitive.Mode.TRIANGLES;
  }) ? "TRIANGLES" : "INDICES";
  return "ATTRIBUTES";
}
function getMeshoptFilter(accessor, doc) {
  const refs = doc.getGraph().listParentEdges(accessor).filter((edge) => !(edge.getParent() instanceof Root));
  for (const ref of refs) {
    const refName = ref.getName();
    const refKey = ref.getAttributes().key || "";
    const isDelta = ref.getParent().propertyType === PropertyType.PRIMITIVE_TARGET;
    if (refName === "indices") return { filter: "NONE" };
    if (refName === "attributes") {
      if (refKey === "POSITION") return { filter: "NONE" };
      if (refKey === "TEXCOORD_0") return { filter: "NONE" };
      if (refKey.startsWith("JOINTS_")) return { filter: "NONE" };
      if (refKey.startsWith("WEIGHTS_")) return { filter: "NONE" };
      if (refKey === "NORMAL" || refKey === "TANGENT") return isDelta ? { filter: "NONE" } : {
        filter: "OCTAHEDRAL",
        bits: 8
      };
    }
    if (refName === "output") {
      const targetPath = getTargetPath(accessor);
      if (targetPath === "rotation") return {
        filter: "QUATERNION",
        bits: 16
      };
      if (targetPath === "translation") return {
        filter: "EXPONENTIAL",
        bits: 12
      };
      if (targetPath === "scale") return {
        filter: "EXPONENTIAL",
        bits: 12
      };
      return { filter: "NONE" };
    }
    if (refName === "input") return { filter: "NONE" };
    if (refName === "inverseBindMatrices") return { filter: "NONE" };
  }
  return { filter: "NONE" };
}
function getTargetPath(accessor) {
  for (const sampler of accessor.listParents()) {
    if (!(sampler instanceof AnimationSampler)) continue;
    for (const channel of sampler.listParents()) {
      if (!(channel instanceof AnimationChannel)) continue;
      return channel.getTargetPath();
    }
  }
  return null;
}
var DEFAULT_ENCODER_OPTIONS$1 = { method: "quantize" };
var EXTMeshoptCompression = class extends Extension {
  extensionName = EXT_MESHOPT_COMPRESSION;
  /** @hidden */
  prereadTypes = [PropertyType.BUFFER, PropertyType.PRIMITIVE];
  /** @hidden */
  prewriteTypes = [PropertyType.BUFFER, PropertyType.ACCESSOR];
  /** @hidden */
  readDependencies = ["meshopt.decoder"];
  /** @hidden */
  writeDependencies = ["meshopt.encoder"];
  static EXTENSION_NAME = EXT_MESHOPT_COMPRESSION;
  static EncoderMethod = EncoderMethod$1;
  _decoder = null;
  _decoderFallbackBufferMap = /* @__PURE__ */ new Map();
  _encoder = null;
  _encoderOptions = DEFAULT_ENCODER_OPTIONS$1;
  _encoderFallbackBuffer = null;
  _encoderBufferViews = {};
  _encoderBufferViewData = {};
  _encoderBufferViewAccessors = {};
  /** @hidden */
  install(key, dependency) {
    if (key === "meshopt.decoder") this._decoder = dependency;
    if (key === "meshopt.encoder") this._encoder = dependency;
    return this;
  }
  /**
  * Configures Meshopt options for quality/compression tuning. The two methods rely on different
  * pre-processing before compression, and should be compared on the basis of (a) quality/loss
  * and (b) final asset size after _also_ applying a lossless compression such as gzip or brotli.
  *
  * - QUANTIZE: Default. Pre-process with {@link quantize quantize()} (lossy to specified
  * 	precision) before applying lossless Meshopt compression. Offers a considerable compression
  * 	ratio with or without further supercompression. Equivalent to `gltfpack -c`.
  * - FILTER: Pre-process with lossy filters to improve compression, before applying lossless
  *	Meshopt compression. While output may initially be larger than with the QUANTIZE method,
  *	this method will benefit more from supercompression (e.g. gzip or brotli). Equivalent to
  * 	`gltfpack -cc`.
  *
  * Output with the FILTER method will generally be smaller after supercompression (e.g. gzip or
  * brotli) is applied, but may be larger than QUANTIZE output without it. Decoding is very fast
  * with both methods.
  *
  * Example:
  *
  * ```ts
  * import { EXTMeshoptCompression } from '@gltf-transform/extensions';
  *
  * doc.createExtension(EXTMeshoptCompression)
  * 	.setRequired(true)
  * 	.setEncoderOptions({
  * 		method: EXTMeshoptCompression.EncoderMethod.QUANTIZE
  * 	});
  * ```
  */
  setEncoderOptions(options) {
    this._encoderOptions = {
      ...DEFAULT_ENCODER_OPTIONS$1,
      ...options
    };
    return this;
  }
  /**********************************************************************************************
  * Decoding.
  */
  /** @internal Checks preconditions, decodes buffer views, and creates decoded primitives. */
  preread(context, propertyType) {
    if (!this._decoder) {
      if (!this.isRequired()) return this;
      throw new Error(`[${EXT_MESHOPT_COMPRESSION}] Please install extension dependency, "meshopt.decoder".`);
    }
    if (!this._decoder.supported) {
      if (!this.isRequired()) return this;
      throw new Error(`[${EXT_MESHOPT_COMPRESSION}]: Missing WASM support.`);
    }
    if (propertyType === PropertyType.BUFFER) this._prereadBuffers(context);
    else if (propertyType === PropertyType.PRIMITIVE) this._prereadPrimitives(context);
    return this;
  }
  /** @internal Decode buffer views. */
  _prereadBuffers(context) {
    const jsonDoc = context.jsonDoc;
    (jsonDoc.json.bufferViews || []).forEach((viewDef, index) => {
      if (!viewDef.extensions || !viewDef.extensions["EXT_meshopt_compression"]) return;
      const meshoptDef = viewDef.extensions[EXT_MESHOPT_COMPRESSION];
      const byteOffset = meshoptDef.byteOffset || 0;
      const byteLength = meshoptDef.byteLength || 0;
      const count = meshoptDef.count;
      const stride = meshoptDef.byteStride;
      const result = new Uint8Array(count * stride);
      const bufferDef = jsonDoc.json.buffers[meshoptDef.buffer];
      const resource = bufferDef.uri ? jsonDoc.resources[bufferDef.uri] : jsonDoc.resources[GLB_BUFFER];
      const source = BufferUtils.toView(resource, byteOffset, byteLength);
      this._decoder.decodeGltfBuffer(result, count, stride, source, meshoptDef.mode, meshoptDef.filter);
      context.bufferViews[index] = result;
    });
  }
  /**
  * Mark fallback buffers and replacements.
  *
  * Note: Alignment with primitives is arbitrary; this just needs to happen
  * after Buffers have been parsed.
  * @internal
  */
  _prereadPrimitives(context) {
    const jsonDoc = context.jsonDoc;
    (jsonDoc.json.bufferViews || []).forEach((viewDef) => {
      if (!viewDef.extensions || !viewDef.extensions["EXT_meshopt_compression"]) return;
      const meshoptDef = viewDef.extensions[EXT_MESHOPT_COMPRESSION];
      const buffer = context.buffers[meshoptDef.buffer];
      const fallbackBuffer = context.buffers[viewDef.buffer];
      const fallbackBufferDef = jsonDoc.json.buffers[viewDef.buffer];
      if (isFallbackBuffer(fallbackBufferDef)) this._decoderFallbackBufferMap.set(fallbackBuffer, buffer);
    });
  }
  /** @hidden Removes Fallback buffers, if extension is required. */
  read(_context) {
    if (!this.isRequired()) return this;
    for (const [fallbackBuffer, buffer] of this._decoderFallbackBufferMap) {
      for (const parent of fallbackBuffer.listParents()) if (parent instanceof Accessor) parent.swap(fallbackBuffer, buffer);
      fallbackBuffer.dispose();
    }
    return this;
  }
  /**********************************************************************************************
  * Encoding.
  */
  /** @internal Claims accessors that can be compressed and writes compressed buffer views. */
  prewrite(context, propertyType) {
    if (propertyType === PropertyType.ACCESSOR) this._prewriteAccessors(context);
    else if (propertyType === PropertyType.BUFFER) this._prewriteBuffers(context);
    return this;
  }
  /** @internal Claims accessors that can be compressed. */
  _prewriteAccessors(context) {
    const json = context.jsonDoc.json;
    const encoder = this._encoder;
    const options = this._encoderOptions;
    const graph = this.document.getGraph();
    const fallbackBuffer = this.document.createBuffer();
    const fallbackBufferIndex = this.document.getRoot().listBuffers().indexOf(fallbackBuffer);
    let nextID = 1;
    const parentToID = /* @__PURE__ */ new Map();
    const getParentID = (property) => {
      for (const parent of graph.listParents(property)) {
        if (parent.propertyType === PropertyType.ROOT) continue;
        let id = parentToID.get(property);
        if (id === void 0) parentToID.set(property, id = nextID++);
        return id;
      }
      return -1;
    };
    this._encoderFallbackBuffer = fallbackBuffer;
    this._encoderBufferViews = {};
    this._encoderBufferViewData = {};
    this._encoderBufferViewAccessors = {};
    for (const accessor of this.document.getRoot().listAccessors()) {
      if (getTargetPath(accessor) === "weights") continue;
      if (accessor.getSparse()) continue;
      const usage = context.getAccessorUsage(accessor);
      const parentID = context.accessorUsageGroupedByParent.has(usage) ? getParentID(accessor) : null;
      const mode = getMeshoptMode(accessor, usage);
      const filter = options.method === "filter" ? getMeshoptFilter(accessor, this.document) : { filter: "NONE" };
      const preparedAccessor = prepareAccessor(accessor, encoder, mode, filter);
      const { array, byteStride } = preparedAccessor;
      const buffer = accessor.getBuffer();
      if (!buffer) throw new Error(`${EXT_MESHOPT_COMPRESSION}: Missing buffer for accessor.`);
      const bufferIndex = this.document.getRoot().listBuffers().indexOf(buffer);
      const key = [
        usage,
        parentID,
        mode,
        filter.filter,
        byteStride,
        bufferIndex
      ].join(":");
      let bufferView = this._encoderBufferViews[key];
      let bufferViewData = this._encoderBufferViewData[key];
      let bufferViewAccessors = this._encoderBufferViewAccessors[key];
      if (!bufferView || !bufferViewData) {
        bufferViewAccessors = this._encoderBufferViewAccessors[key] = [];
        bufferViewData = this._encoderBufferViewData[key] = [];
        bufferView = this._encoderBufferViews[key] = {
          buffer: fallbackBufferIndex,
          target: WriterContext.USAGE_TO_TARGET[usage],
          byteOffset: 0,
          byteLength: 0,
          byteStride: usage === WriterContext.BufferViewUsage.ARRAY_BUFFER ? byteStride : void 0,
          extensions: { [EXT_MESHOPT_COMPRESSION]: {
            buffer: bufferIndex,
            byteOffset: 0,
            byteLength: 0,
            mode,
            filter: filter.filter !== "NONE" ? filter.filter : void 0,
            byteStride,
            count: 0
          } }
        };
      }
      const accessorDef = context.createAccessorDef(accessor);
      accessorDef.componentType = preparedAccessor.componentType;
      accessorDef.normalized = preparedAccessor.normalized;
      accessorDef.byteOffset = bufferView.byteLength;
      if (accessorDef.min && preparedAccessor.min) accessorDef.min = preparedAccessor.min;
      if (accessorDef.max && preparedAccessor.max) accessorDef.max = preparedAccessor.max;
      context.accessorIndexMap.set(accessor, json.accessors.length);
      json.accessors.push(accessorDef);
      bufferViewAccessors.push(accessorDef);
      bufferViewData.push(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      bufferView.byteLength += array.byteLength;
      bufferView.extensions.EXT_meshopt_compression.count += accessor.getCount();
    }
  }
  /** @internal Writes compressed buffer views. */
  _prewriteBuffers(context) {
    const encoder = this._encoder;
    for (const key in this._encoderBufferViews) {
      const bufferView = this._encoderBufferViews[key];
      const bufferViewData = this._encoderBufferViewData[key];
      const buffer = this.document.getRoot().listBuffers()[bufferView.extensions[EXT_MESHOPT_COMPRESSION].buffer];
      const otherBufferViews = context.otherBufferViews.get(buffer) || [];
      const { count, byteStride, mode } = bufferView.extensions[EXT_MESHOPT_COMPRESSION];
      const srcArray = BufferUtils.concat(bufferViewData);
      const dstArray = encoder.encodeGltfBuffer(srcArray, count, byteStride, mode);
      const compressedData = BufferUtils.pad(dstArray);
      bufferView.extensions[EXT_MESHOPT_COMPRESSION].byteLength = dstArray.byteLength;
      bufferViewData.length = 0;
      bufferViewData.push(compressedData);
      otherBufferViews.push(compressedData);
      context.otherBufferViews.set(buffer, otherBufferViews);
    }
  }
  /** @hidden Puts encoded data into glTF output. */
  write(context) {
    let fallbackBufferByteOffset = 0;
    for (const key in this._encoderBufferViews) {
      const bufferView = this._encoderBufferViews[key];
      const bufferViewData = this._encoderBufferViewData[key][0];
      const bufferViewIndex = context.otherBufferViewsIndexMap.get(bufferViewData);
      const bufferViewAccessors = this._encoderBufferViewAccessors[key];
      for (const accessorDef of bufferViewAccessors) accessorDef.bufferView = bufferViewIndex;
      const finalBufferViewDef = context.jsonDoc.json.bufferViews[bufferViewIndex];
      const compressedByteOffset = finalBufferViewDef.byteOffset || 0;
      Object.assign(finalBufferViewDef, bufferView);
      finalBufferViewDef.byteOffset = fallbackBufferByteOffset;
      const bufferViewExtensionDef = finalBufferViewDef.extensions[EXT_MESHOPT_COMPRESSION];
      bufferViewExtensionDef.byteOffset = compressedByteOffset;
      fallbackBufferByteOffset += BufferUtils.padNumber(bufferView.byteLength);
    }
    const fallbackBuffer = this._encoderFallbackBuffer;
    const fallbackBufferIndex = context.bufferIndexMap.get(fallbackBuffer);
    const fallbackBufferDef = context.jsonDoc.json.buffers[fallbackBufferIndex];
    fallbackBufferDef.byteLength = fallbackBufferByteOffset;
    fallbackBufferDef.extensions = { [EXT_MESHOPT_COMPRESSION]: { fallback: true } };
    fallbackBuffer.dispose();
    return this;
  }
};
var StructuralMetadata = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "StructuralMetadata";
    this.parentTypes = [PropertyType.ROOT];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      schema: null,
      schemaUri: "",
      propertyTables: new RefList(),
      propertyTextures: new RefList(),
      propertyAttributes: new RefList()
    });
  }
  getSchema() {
    return this.getRef("schema");
  }
  setSchema(schema) {
    return this.setRef("schema", schema);
  }
  getSchemaUri() {
    return this.get("schemaUri");
  }
  setSchemaUri(schemaUri) {
    return this.set("schemaUri", schemaUri);
  }
  listPropertyTables() {
    return this.listRefs("propertyTables");
  }
  addPropertyTable(propertyTable) {
    return this.addRef("propertyTables", propertyTable);
  }
  removePropertyTable(propertyTable) {
    return this.removeRef("propertyTables", propertyTable);
  }
  listPropertyTextures() {
    return this.listRefs("propertyTextures");
  }
  addPropertyTexture(propertyTexture) {
    return this.addRef("propertyTextures", propertyTexture);
  }
  removePropertyTexture(propertyTexture) {
    return this.removeRef("propertyTextures", propertyTexture);
  }
  listPropertyAttributes() {
    return this.listRefs("propertyAttributes");
  }
  addPropertyAttribute(propertyAttribute) {
    return this.addRef("propertyAttributes", propertyAttribute);
  }
  removePropertyAttribute(propertyAttribute) {
    return this.removeRef("propertyAttributes", propertyAttribute);
  }
};
var Schema = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "Schema";
    this.parentTypes = ["StructuralMetadata"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      description: "",
      version: "",
      classes: new RefMap(),
      enums: new RefMap()
    });
  }
  getId() {
    return this.get("id");
  }
  setId(name) {
    return this.set("id", name);
  }
  getDescription() {
    return this.get("description");
  }
  setDescription(description) {
    return this.set("description", description);
  }
  getVersion() {
    return this.get("version");
  }
  setVersion(version) {
    return this.set("version", version);
  }
  setClass(key, value) {
    return this.setRefMap("classes", key, value);
  }
  getClass(key) {
    return this.getRefMap("classes", key);
  }
  listClassKeys() {
    return this.listRefMapKeys("classes");
  }
  listClassValues() {
    return this.listRefMapValues("classes");
  }
  setEnum(key, value) {
    return this.setRefMap("enums", key, value);
  }
  getEnum(key) {
    return this.getRefMap("enums", key);
  }
  listEnumKeys() {
    return this.listRefMapKeys("enums");
  }
  listEnumValues() {
    return this.listRefMapValues("enums");
  }
};
var Class = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "Class";
    this.parentTypes = ["Schema"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      description: "",
      properties: new RefMap()
    });
  }
  getDescription() {
    return this.get("description");
  }
  setDescription(description) {
    return this.set("description", description);
  }
  setProperty(key, value) {
    return this.setRefMap("properties", key, value);
  }
  getProperty(key) {
    return this.getRefMap("properties", key);
  }
  listPropertyKeys() {
    return this.listRefMapKeys("properties");
  }
  listPropertyValues() {
    return this.listRefMapValues("properties");
  }
};
var ClassProperty = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "ClassProperty";
    this.parentTypes = ["Class"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      description: "",
      componentType: null,
      enumType: null,
      array: null,
      count: null,
      normalized: null,
      offset: null,
      scale: null,
      max: null,
      min: null,
      required: null,
      noData: null,
      default: null
    });
  }
  getDescription() {
    return this.get("description");
  }
  setDescription(description) {
    return this.set("description", description);
  }
  getType() {
    return this.get("type");
  }
  setType(type) {
    return this.set("type", type);
  }
  getComponentType() {
    return this.get("componentType");
  }
  setComponentType(componentType) {
    return this.set("componentType", componentType);
  }
  getEnumType() {
    return this.get("enumType");
  }
  setEnumType(enumType) {
    return this.set("enumType", enumType);
  }
  getArray() {
    return this.get("array");
  }
  setArray(array) {
    return this.set("array", array);
  }
  getCount() {
    return this.get("count");
  }
  setCount(count) {
    return this.set("count", count);
  }
  getNormalized() {
    return this.get("normalized");
  }
  setNormalized(normalized) {
    return this.set("normalized", normalized);
  }
  getOffset() {
    return this.get("offset");
  }
  setOffset(offset) {
    return this.set("offset", offset);
  }
  getScale() {
    return this.get("scale");
  }
  setScale(scale) {
    return this.set("scale", scale);
  }
  getMax() {
    return this.get("max");
  }
  setMax(max) {
    return this.set("max", max);
  }
  getMin() {
    return this.get("min");
  }
  setMin(min) {
    return this.set("min", min);
  }
  getRequired() {
    return this.get("required");
  }
  setRequired(required) {
    return this.set("required", required);
  }
  getNoData() {
    return this.get("noData");
  }
  setNoData(noData) {
    return this.set("noData", noData);
  }
  getDefault() {
    return this.get("default");
  }
  setDefault(defaultValue) {
    return this.set("default", defaultValue);
  }
};
var Enum = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "Enum";
    this.parentTypes = ["Schema"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      description: "",
      valueType: "UINT16",
      values: new RefList()
    });
  }
  getDescription() {
    return this.get("description");
  }
  setDescription(description) {
    return this.set("description", description);
  }
  getValueType() {
    return this.get("valueType");
  }
  setValueType(valueType) {
    return this.set("valueType", valueType);
  }
  listValues() {
    return this.listRefs("values");
  }
  addEnumValue(enumValue) {
    return this.addRef("values", enumValue);
  }
  removeEnumValue(enumValue) {
    return this.removeRef("values", enumValue);
  }
};
var EnumValue = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "EnumValue";
    this.parentTypes = ["Enum"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { description: null });
  }
  getDescription() {
    return this.get("description");
  }
  setDescription(description) {
    return this.set("description", description);
  }
  getValue() {
    return this.get("value");
  }
  setValue(value) {
    return this.set("value", value);
  }
};
var PropertyTable = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "PropertyTable";
    this.parentTypes = ["StructuralMetadata"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { properties: new RefMap() });
  }
  getClass() {
    return this.get("class");
  }
  setClass(className) {
    return this.set("class", className);
  }
  getCount() {
    return this.get("count");
  }
  setCount(count) {
    return this.set("count", count);
  }
  setProperty(key, value) {
    return this.setRefMap("properties", key, value);
  }
  getProperty(key) {
    return this.getRefMap("properties", key);
  }
  listPropertyKeys() {
    return this.listRefMapKeys("properties");
  }
  listPropertyValues() {
    return this.listRefMapValues("properties");
  }
};
var PropertyTableProperty = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "PropertyTableProperty";
    this.parentTypes = ["PropertyTable"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      arrayOffsets: null,
      stringOffsets: null,
      arrayOffsetType: null,
      stringOffsetType: null,
      offset: null,
      scale: null,
      max: null,
      min: null
    });
  }
  getValues() {
    return this.get("values");
  }
  setValues(values) {
    return this.set("values", values);
  }
  getArrayOffsets() {
    return this.get("arrayOffsets");
  }
  setArrayOffsets(arrayOffsets) {
    return this.set("arrayOffsets", arrayOffsets);
  }
  getStringOffsets() {
    return this.get("stringOffsets");
  }
  setStringOffsets(stringOffsets) {
    return this.set("stringOffsets", stringOffsets);
  }
  getArrayOffsetType() {
    return this.get("arrayOffsetType");
  }
  setArrayOffsetType(arrayOffsetType) {
    return this.set("arrayOffsetType", arrayOffsetType);
  }
  getStringOffsetType() {
    return this.get("stringOffsetType");
  }
  setStringOffsetType(stringOffsetType) {
    return this.set("stringOffsetType", stringOffsetType);
  }
  getOffset() {
    return this.get("offset");
  }
  setOffset(offset) {
    return this.set("offset", offset);
  }
  getScale() {
    return this.get("scale");
  }
  setScale(scale) {
    return this.set("scale", scale);
  }
  getMax() {
    return this.get("max");
  }
  setMax(max) {
    return this.set("max", max);
  }
  getMin() {
    return this.get("min");
  }
  setMin(min) {
    return this.set("min", min);
  }
};
var PropertyTexture = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "PropertyTexture";
    this.parentTypes = ["StructuralMetadata"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { properties: new RefMap() });
  }
  getClass() {
    return this.get("class");
  }
  setClass(_class) {
    return this.set("class", _class);
  }
  setProperty(key, value) {
    return this.setRefMap("properties", key, value);
  }
  getProperty(key) {
    return this.getRefMap("properties", key);
  }
  listPropertyKeys() {
    return this.listRefMapKeys("properties");
  }
  listPropertyValues() {
    return this.listRefMapValues("properties");
  }
};
var PropertyTextureProperty = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "PropertyTextureProperty";
    this.parentTypes = ["PropertyTexture"];
  }
  getDefaults() {
    const defaultTextureInfo = new TextureInfo(this.graph, "textureInfo");
    defaultTextureInfo.setMinFilter(TextureInfo.MagFilter.NEAREST);
    defaultTextureInfo.setMagFilter(TextureInfo.MagFilter.NEAREST);
    return Object.assign(super.getDefaults(), {
      channels: [0],
      texture: null,
      textureInfo: defaultTextureInfo,
      offset: null,
      scale: null,
      max: null,
      min: null
    });
  }
  getChannels() {
    return this.get("channels");
  }
  setChannels(channels) {
    return this.set("channels", channels);
  }
  getTexture() {
    return this.getRef("texture");
  }
  setTexture(texture) {
    return this.setRef("texture", texture);
  }
  getTextureInfo() {
    return this.getRef("texture") ? this.getRef("textureInfo") : null;
  }
  getOffset() {
    return this.get("offset");
  }
  setOffset(offset) {
    return this.set("offset", offset);
  }
  getScale() {
    return this.get("scale");
  }
  setScale(scale) {
    return this.set("scale", scale);
  }
  getMax() {
    return this.get("max");
  }
  setMax(max) {
    return this.set("max", max);
  }
  getMin() {
    return this.get("min");
  }
  setMin(min) {
    return this.set("min", min);
  }
};
var PropertyAttribute = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "PropertyAttribute";
    this.parentTypes = ["StructuralMetadata"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { properties: new RefMap() });
  }
  getClass() {
    return this.get("class");
  }
  setClass(_class) {
    return this.set("class", _class);
  }
  setProperty(key, value) {
    return this.setRefMap("properties", key, value);
  }
  getProperty(key) {
    return this.getRefMap("properties", key);
  }
  listPropertyKeys() {
    return this.listRefMapKeys("properties");
  }
  listPropertyValues() {
    return this.listRefMapValues("properties");
  }
};
var PropertyAttributeProperty = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "PropertyAttributeProperty";
    this.parentTypes = ["PropertyAttribute"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      offset: null,
      scale: null,
      max: null,
      min: null
    });
  }
  getAttribute() {
    return this.get("attribute");
  }
  setAttribute(attribute) {
    return this.set("attribute", attribute);
  }
  getOffset() {
    return this.get("offset");
  }
  setOffset(offset) {
    return this.set("offset", offset);
  }
  getScale() {
    return this.get("scale");
  }
  setScale(scale) {
    return this.set("scale", scale);
  }
  getMax() {
    return this.get("max");
  }
  setMax(max) {
    return this.set("max", max);
  }
  getMin() {
    return this.get("min");
  }
  setMin(min) {
    return this.set("min", min);
  }
};
var NodeStructuralMetadata = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "NodeStructuralMetadata";
    this.parentTypes = [PropertyType.NODE];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      class: "",
      properties: {}
    });
  }
  getClass() {
    return this.get("class");
  }
  setClass(className) {
    return this.set("class", className);
  }
  getProperties() {
    return this.get("properties");
  }
  setProperties(properties) {
    return this.set("properties", properties);
  }
};
var MeshPrimitiveStructuralMetadata = class extends ExtensionProperty {
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  init() {
    this.extensionName = EXT_STRUCTURAL_METADATA;
    this.propertyType = "MeshPrimitiveStructuralMetadata";
    this.parentTypes = [PropertyType.PRIMITIVE];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      propertyTextures: new RefList(),
      propertyAttributes: new RefList()
    });
  }
  listPropertyTextures() {
    return this.listRefs("propertyTextures");
  }
  addPropertyTexture(propertyTexture) {
    return this.addRef("propertyTextures", propertyTexture);
  }
  removePropertyTexture(propertyTexture) {
    return this.removeRef("propertyTextures", propertyTexture);
  }
  listPropertyAttributes() {
    return this.listRefs("propertyAttributes");
  }
  addPropertyAttribute(propertyAttribute) {
    return this.addRef("propertyAttributes", propertyAttribute);
  }
  removePropertyAttribute(propertyAttribute) {
    return this.removeRef("propertyAttributes", propertyAttribute);
  }
};
var EXTStructuralMetadata = class extends Extension {
  extensionName = EXT_STRUCTURAL_METADATA;
  static EXTENSION_NAME = EXT_STRUCTURAL_METADATA;
  /**
  * Must preparate buffer data, because property tables directly
  * reference buffer views, not accessors.
  *
  * @hidden
  */
  prewriteTypes = [PropertyType.BUFFER];
  /**
  * Must read EXT_structural_metadata before EXT_mesh_features.
  *
  * @hidden
  */
  prereadTypes = [PropertyType.SCENE];
  createStructuralMetadata() {
    return new StructuralMetadata(this.document.getGraph());
  }
  createSchema() {
    return new Schema(this.document.getGraph());
  }
  createClass() {
    return new Class(this.document.getGraph());
  }
  createClassProperty() {
    return new ClassProperty(this.document.getGraph());
  }
  createEnum() {
    return new Enum(this.document.getGraph());
  }
  createEnumValue() {
    return new EnumValue(this.document.getGraph());
  }
  createPropertyTable() {
    return new PropertyTable(this.document.getGraph());
  }
  createPropertyTableProperty() {
    return new PropertyTableProperty(this.document.getGraph());
  }
  createPropertyTexture() {
    return new PropertyTexture(this.document.getGraph());
  }
  createPropertyTextureProperty() {
    return new PropertyTextureProperty(this.document.getGraph());
  }
  createPropertyAttribute() {
    return new PropertyAttribute(this.document.getGraph());
  }
  createPropertyAttributeProperty() {
    return new PropertyAttributeProperty(this.document.getGraph());
  }
  createNodeStructuralMetadata() {
    return new NodeStructuralMetadata(this.document.getGraph());
  }
  createMeshPrimitiveStructuralMetadata() {
    return new MeshPrimitiveStructuralMetadata(this.document.getGraph());
  }
  read(_context) {
    return this;
  }
  preread(context) {
    const root = this.document.getRoot();
    const { json } = context.jsonDoc;
    const structuralMetadataDef = json.extensions[EXT_STRUCTURAL_METADATA];
    const structuralMetadata = _readStructuralMetadata(this, context, structuralMetadataDef);
    root.setExtension(EXT_STRUCTURAL_METADATA, structuralMetadata);
    (json.meshes || []).forEach((meshDef, meshIndex) => {
      const primitives = context.meshes[meshIndex].listPrimitives();
      (meshDef.primitives || []).forEach((primDef, primIndex) => {
        const prim = primitives[primIndex];
        this._readPrimitive(structuralMetadata, prim, primDef);
      });
    });
    (json.nodes || []).forEach((nodeDef, nodeIndex) => {
      this._readNode(context.nodes[nodeIndex], nodeDef);
    });
    return this;
  }
  /** @hidden */
  _readPrimitive(structuralMetadata, prim, primDef) {
    if (!primDef.extensions || !primDef.extensions["EXT_structural_metadata"]) return;
    const meshPrimitiveStructuralMetadata = this.createMeshPrimitiveStructuralMetadata();
    const meshPrimitiveStructuralMetadataDef = primDef.extensions[EXT_STRUCTURAL_METADATA];
    const propertyTextures = structuralMetadata.listPropertyTextures();
    const propertyTextureIndexDefs = meshPrimitiveStructuralMetadataDef.propertyTextures || [];
    for (const propertyTextureIndexDef of propertyTextureIndexDefs) {
      const propertyTexture = propertyTextures[propertyTextureIndexDef];
      meshPrimitiveStructuralMetadata.addPropertyTexture(propertyTexture);
    }
    const propertyAttributes = structuralMetadata.listPropertyAttributes();
    const propertyAttributeIndexDefs = meshPrimitiveStructuralMetadataDef.propertyAttributes || [];
    for (const propertyAttributeIndexDef of propertyAttributeIndexDefs) {
      const propertyAttribute = propertyAttributes[propertyAttributeIndexDef];
      meshPrimitiveStructuralMetadata.addPropertyAttribute(propertyAttribute);
    }
    prim.setExtension(EXT_STRUCTURAL_METADATA, meshPrimitiveStructuralMetadata);
  }
  /** @hidden */
  _readNode(node, nodeDef) {
    if (!nodeDef.extensions || !nodeDef.extensions["EXT_structural_metadata"]) return;
    const nodeStructuralMetadataDef = nodeDef.extensions[EXT_STRUCTURAL_METADATA];
    const nodeStructuralMetadata = this.createNodeStructuralMetadata().setClass(nodeStructuralMetadataDef.class).setProperties(nodeStructuralMetadataDef.properties);
    node.setExtension(EXT_STRUCTURAL_METADATA, nodeStructuralMetadata);
  }
  write(context) {
    const root = this.document.getRoot();
    const structuralMetadata = root.getExtension(EXT_STRUCTURAL_METADATA);
    if (!structuralMetadata) return this;
    const gltfDef = context.jsonDoc.json;
    const structuralMetadataDef = _writeStructuralMetadataDef(context, structuralMetadata);
    gltfDef.extensions = gltfDef.extensions || {};
    gltfDef.extensions[EXT_STRUCTURAL_METADATA] = structuralMetadataDef;
    const meshes = root.listMeshes();
    const meshDefs = gltfDef.meshes;
    if (meshDefs) for (const mesh of meshes) {
      const meshDef = meshDefs[context.meshIndexMap.get(mesh)];
      mesh.listPrimitives().forEach((prim, primIndex) => {
        const primDef = meshDef.primitives[primIndex];
        this._writePrimitive(structuralMetadata, prim, primDef);
      });
    }
    const nodes = root.listNodes();
    const nodeDefs = gltfDef.nodes;
    if (nodeDefs) for (const node of nodes) {
      const nodeIndex = context.nodeIndexMap.get(node);
      this._writeNode(node, nodeDefs[nodeIndex]);
    }
    return this;
  }
  /** @hidden */
  _writePrimitive(structuralMetadata, prim, primDef) {
    const meshPrimitiveStructuralMetadata = prim.getExtension(EXT_STRUCTURAL_METADATA);
    if (!meshPrimitiveStructuralMetadata) return;
    const globalPropertyTextures = structuralMetadata.listPropertyTextures();
    const globalPropertyAttributes = structuralMetadata.listPropertyAttributes();
    let propertyTextureDefs;
    let propertyAttributeDefs;
    const propertyTextures = meshPrimitiveStructuralMetadata.listPropertyTextures();
    if (propertyTextures.length > 0) {
      propertyTextureDefs = [];
      for (const propertyTexture of propertyTextures) {
        const index = globalPropertyTextures.indexOf(propertyTexture);
        if (index >= 0) propertyTextureDefs.push(index);
        else throw new Error(`${EXT_STRUCTURAL_METADATA}: Invalid property texture in mesh primitive`);
      }
    }
    const propertyAttributes = meshPrimitiveStructuralMetadata.listPropertyAttributes();
    if (propertyAttributes.length > 0) {
      propertyAttributeDefs = [];
      for (const propertyAttribute of propertyAttributes) {
        const index = globalPropertyAttributes.indexOf(propertyAttribute);
        if (index >= 0) propertyAttributeDefs.push(index);
        else throw new Error(`${EXT_STRUCTURAL_METADATA}: Invalid property attribute in mesh primitive`);
      }
    }
    const meshPrimitiveStructuralMetadataDef = {
      propertyTextures: propertyTextureDefs,
      propertyAttributes: propertyAttributeDefs
    };
    primDef.extensions = primDef.extensions || {};
    primDef.extensions[EXT_STRUCTURAL_METADATA] = meshPrimitiveStructuralMetadataDef;
  }
  /** @hidden */
  _writeNode(node, nodeDef) {
    const nodeStructuralMetadata = node.getExtension("EXT_structural_metadata");
    if (!nodeStructuralMetadata) return;
    nodeDef.extensions = nodeDef.extensions || {};
    nodeDef.extensions[EXT_STRUCTURAL_METADATA] = {
      class: nodeStructuralMetadata.getClass(),
      properties: nodeStructuralMetadata.getProperties()
    };
  }
  prewrite(context, propertyType) {
    if (propertyType === PropertyType.BUFFER) this._prewriteBuffers(context);
    return this;
  }
  /**
  * Collects all buffer views that are referred to by the property tables, and
  * store them as "otherBufferViews" of the writer context (for the main
  * buffer), to make sure that they are part of the buffer when it is
  * eventually written in Writer.ts.
  *
  * @hidden
  */
  _prewriteBuffers(context) {
    const document = this.document;
    const structuralMetadata = document.getRoot().getExtension(EXT_STRUCTURAL_METADATA);
    context.jsonDoc.json.bufferViews ||= [];
    for (const propertyTable of structuralMetadata.listPropertyTables()) for (const propertyValue of propertyTable.listPropertyValues()) {
      const otherBufferViews = getOrCreateOtherBufferViews(document, context);
      otherBufferViews.push(propertyValue.getValues());
      const arrayOffsets = propertyValue.getArrayOffsets();
      if (arrayOffsets) otherBufferViews.push(arrayOffsets);
      const stringOffsets = propertyValue.getStringOffsets();
      if (stringOffsets) otherBufferViews.push(stringOffsets);
    }
  }
};
function _readStructuralMetadata(ext, context, structuralMetadataDef) {
  const structuralMetadata = ext.createStructuralMetadata();
  if (structuralMetadataDef.schema !== void 0) {
    const schema = _readSchema(ext, structuralMetadataDef.schema);
    structuralMetadata.setSchema(schema);
  } else if (structuralMetadataDef.schemaUri) {
    const schemaUri = structuralMetadataDef.schemaUri;
    structuralMetadata.setSchemaUri(schemaUri);
  }
  const propertyTextureDefs = structuralMetadataDef.propertyTextures || [];
  for (const propertyTextureDef of propertyTextureDefs) {
    const propertyTexture = _readPropertyTexture(ext, context, propertyTextureDef);
    structuralMetadata.addPropertyTexture(propertyTexture);
  }
  const propertyTableDefs = structuralMetadataDef.propertyTables || [];
  for (const propertyTableDef of propertyTableDefs) {
    const propertyTable = _readPropertyTable(ext, context, propertyTableDef);
    structuralMetadata.addPropertyTable(propertyTable);
  }
  const propertyAttributeDefs = structuralMetadataDef.propertyAttributes || [];
  for (const propertyAttributeDef of propertyAttributeDefs) {
    const propertyAttribute = _readPropertyAttribute(ext, propertyAttributeDef);
    structuralMetadata.addPropertyAttribute(propertyAttribute);
  }
  return structuralMetadata;
}
function _readSchema(ext, schemaDef) {
  const schema = ext.createSchema().setId(schemaDef.id);
  if (schemaDef.name !== void 0) schema.setName(schemaDef.name);
  if (schemaDef.description !== void 0) schema.setDescription(schemaDef.description);
  if (schemaDef.version !== void 0) schema.setVersion(schemaDef.version);
  const classes = schemaDef.classes || {};
  for (const classKey of Object.keys(classes)) {
    const classDef = classes[classKey];
    schema.setClass(classKey, _readClass(ext, classDef));
  }
  const enums = schemaDef.enums || {};
  for (const enumKey of Object.keys(enums)) schema.setEnum(enumKey, _readEnum(ext, enums[enumKey]));
  return schema;
}
function _readClass(ext, classDef) {
  const classObject = ext.createClass();
  if (classDef.name !== void 0) classObject.setName(classDef.name);
  if (classDef.description !== void 0) classObject.setDescription(classDef.description);
  const properties = classDef.properties || {};
  for (const classPropertyKey of Object.keys(properties)) {
    const classProperty = _readClassProperty(ext, properties[classPropertyKey]);
    classObject.setProperty(classPropertyKey, classProperty);
  }
  return classObject;
}
function _readClassProperty(ext, classPropertyDef) {
  const classProperty = ext.createClassProperty().setType(classPropertyDef.type);
  if (classPropertyDef.name !== void 0) classProperty.setName(classPropertyDef.name);
  if (classPropertyDef.description !== void 0) classProperty.setDescription(classPropertyDef.description);
  if (classPropertyDef.componentType !== void 0) classProperty.setComponentType(classPropertyDef.componentType);
  if (classPropertyDef.enumType !== void 0) classProperty.setEnumType(classPropertyDef.enumType);
  if (classPropertyDef.array !== void 0) classProperty.setArray(classPropertyDef.array);
  if (classPropertyDef.count !== void 0) classProperty.setCount(classPropertyDef.count);
  if (classPropertyDef.normalized !== void 0) classProperty.setNormalized(classPropertyDef.normalized);
  if (classPropertyDef.offset !== void 0) classProperty.setOffset(classPropertyDef.offset);
  if (classPropertyDef.scale !== void 0) classProperty.setScale(classPropertyDef.scale);
  if (classPropertyDef.max !== void 0) classProperty.setMax(classPropertyDef.max);
  if (classPropertyDef.min !== void 0) classProperty.setMin(classPropertyDef.min);
  if (classPropertyDef.required !== void 0) classProperty.setRequired(classPropertyDef.required);
  if (classPropertyDef.noData !== void 0) classProperty.setNoData(classPropertyDef.noData);
  if (classPropertyDef.default !== void 0) classProperty.setDefault(classPropertyDef.default);
  return classProperty;
}
function _readEnum(ext, enumDef) {
  const enumObject = ext.createEnum();
  if (enumDef.name !== void 0) enumObject.setName(enumDef.name);
  if (enumDef.description !== void 0) enumObject.setDescription(enumDef.description);
  if (enumDef.valueType !== void 0) enumObject.setValueType(enumDef.valueType);
  const valueDefs = enumDef.values || {};
  for (const valueDef of valueDefs) enumObject.addEnumValue(_readEnumValue(ext, valueDef));
  return enumObject;
}
function _readEnumValue(ext, enumValueDef) {
  const enumValue = ext.createEnumValue();
  if (enumValueDef.name !== void 0) enumValue.setName(enumValueDef.name);
  if (enumValueDef.description !== void 0) enumValue.setDescription(enumValueDef.description);
  if (enumValueDef.value !== void 0) enumValue.setValue(enumValueDef.value);
  return enumValue;
}
function _readPropertyTexture(ext, context, propertyTextureDef) {
  const propertyTexture = ext.createPropertyTexture();
  propertyTexture.setClass(propertyTextureDef.class);
  if (propertyTextureDef.name !== void 0) propertyTexture.setName(propertyTextureDef.name);
  const properties = propertyTextureDef.properties || {};
  for (const propertyKey of Object.keys(properties)) {
    const propertyTextureProperty = _readPropertyTextureProperty(ext, context, properties[propertyKey]);
    propertyTexture.setProperty(propertyKey, propertyTextureProperty);
  }
  return propertyTexture;
}
function _readPropertyTextureProperty(ext, context, propertyTexturePropertyDef) {
  const propertyTextureProperty = ext.createPropertyTextureProperty();
  const textureDefs = context.jsonDoc.json.textures || [];
  if (propertyTexturePropertyDef.channels) propertyTextureProperty.setChannels(propertyTexturePropertyDef.channels);
  const source = textureDefs[propertyTexturePropertyDef.index].source;
  if (source !== void 0) {
    const texture = context.textures[source];
    propertyTextureProperty.setTexture(texture);
    const textureInfo = propertyTextureProperty.getTextureInfo();
    if (textureInfo) context.setTextureInfo(textureInfo, propertyTexturePropertyDef);
  }
  if (propertyTexturePropertyDef.offset !== void 0) propertyTextureProperty.setOffset(propertyTexturePropertyDef.offset);
  if (propertyTexturePropertyDef.scale !== void 0) propertyTextureProperty.setScale(propertyTexturePropertyDef.scale);
  if (propertyTexturePropertyDef.max !== void 0) propertyTextureProperty.setMax(propertyTexturePropertyDef.max);
  if (propertyTexturePropertyDef.min !== void 0) propertyTextureProperty.setMin(propertyTexturePropertyDef.min);
  return propertyTextureProperty;
}
function _readPropertyTable(ext, context, propertyTableDef) {
  const propertyTable = ext.createPropertyTable().setClass(propertyTableDef.class).setCount(propertyTableDef.count);
  if (propertyTableDef.name !== void 0) propertyTable.setName(propertyTableDef.name);
  const properties = propertyTableDef.properties || {};
  for (const propertyKey of Object.keys(properties)) {
    const propertyTableProperty = _readPropertyTableProperty(ext, context, properties[propertyKey]);
    propertyTable.setProperty(propertyKey, propertyTableProperty);
  }
  return propertyTable;
}
function _readPropertyTableProperty(ext, context, propertyTablePropertyDef) {
  const propertyTableProperty = ext.createPropertyTableProperty();
  const values = getBufferViewData(context, propertyTablePropertyDef.values);
  propertyTableProperty.setValues(values);
  if (propertyTablePropertyDef.arrayOffsets !== void 0) {
    const arrayOffsetsData = getBufferViewData(context, propertyTablePropertyDef.arrayOffsets);
    propertyTableProperty.setArrayOffsets(arrayOffsetsData);
  }
  if (propertyTablePropertyDef.stringOffsets !== void 0) {
    const stringOffsetsData = getBufferViewData(context, propertyTablePropertyDef.stringOffsets);
    propertyTableProperty.setStringOffsets(stringOffsetsData);
  }
  if (propertyTablePropertyDef.arrayOffsetType !== void 0) propertyTableProperty.setArrayOffsetType(propertyTablePropertyDef.arrayOffsetType);
  if (propertyTablePropertyDef.stringOffsetType !== void 0) propertyTableProperty.setStringOffsetType(propertyTablePropertyDef.stringOffsetType);
  if (propertyTablePropertyDef.offset !== void 0) propertyTableProperty.setOffset(propertyTablePropertyDef.offset);
  if (propertyTablePropertyDef.scale !== void 0) propertyTableProperty.setScale(propertyTablePropertyDef.scale);
  if (propertyTablePropertyDef.max !== void 0) propertyTableProperty.setMax(propertyTablePropertyDef.max);
  if (propertyTablePropertyDef.min !== void 0) propertyTableProperty.setMin(propertyTablePropertyDef.min);
  return propertyTableProperty;
}
function _readPropertyAttribute(ext, propertyAttributeDef) {
  const propertyAttribute = ext.createPropertyAttribute();
  propertyAttribute.setClass(propertyAttributeDef.class);
  if (propertyAttributeDef.name !== void 0) propertyAttribute.setName(propertyAttributeDef.name);
  const properties = propertyAttributeDef.properties || {};
  for (const propertyKey of Object.keys(properties)) {
    const propertyAttributeProperty = _readPropertyAttributeProperty(ext, properties[propertyKey]);
    propertyAttribute.setProperty(propertyKey, propertyAttributeProperty);
  }
  return propertyAttribute;
}
function _readPropertyAttributeProperty(ext, propertyAttributePropertyDef) {
  const propertyAttributeProperty = ext.createPropertyAttributeProperty();
  propertyAttributeProperty.setAttribute(propertyAttributePropertyDef.attribute);
  if (propertyAttributePropertyDef.offset !== void 0) propertyAttributeProperty.setOffset(propertyAttributePropertyDef.offset);
  if (propertyAttributePropertyDef.scale !== void 0) propertyAttributeProperty.setScale(propertyAttributePropertyDef.scale);
  if (propertyAttributePropertyDef.max !== void 0) propertyAttributeProperty.setMax(propertyAttributePropertyDef.max);
  if (propertyAttributePropertyDef.min !== void 0) propertyAttributeProperty.setMin(propertyAttributePropertyDef.min);
  return propertyAttributeProperty;
}
function _writeStructuralMetadataDef(context, structuralMetadata) {
  const structuralMetadataDef = {};
  const schema = structuralMetadata.getSchema();
  if (schema) structuralMetadataDef.schema = _writeSchemaDef(schema);
  const schemaUri = structuralMetadata.getSchemaUri();
  if (schemaUri) structuralMetadataDef.schemaUri = schemaUri;
  const propertyTables = structuralMetadata.listPropertyTables();
  if (propertyTables.length > 0) {
    const propertyTableDefs = [];
    for (const propertyTable of propertyTables) {
      const propertyTableDef = _writePropertyTableDef(context, propertyTable);
      propertyTableDefs.push(propertyTableDef);
    }
    structuralMetadataDef.propertyTables = propertyTableDefs;
  }
  const propertyTextures = structuralMetadata.listPropertyTextures();
  if (propertyTextures.length > 0) {
    const propertyTextureDefs = [];
    for (const propertyTexture of propertyTextures) {
      const propertyTextureDef = _writePropertyTextureDef(context, propertyTexture);
      propertyTextureDefs.push(propertyTextureDef);
    }
    structuralMetadataDef.propertyTextures = propertyTextureDefs;
  }
  const propertyAttributes = structuralMetadata.listPropertyAttributes();
  if (propertyAttributes.length > 0) {
    const propertyAttributeDefs = [];
    for (const propertyAttribute of propertyAttributes) {
      const propertyAttributeDef = _writePropertyAttributeDef(propertyAttribute);
      propertyAttributeDefs.push(propertyAttributeDef);
    }
    structuralMetadataDef.propertyAttributes = propertyAttributeDefs;
  }
  return structuralMetadataDef;
}
function _writeSchemaDef(schema) {
  const schemaDef = { id: schema.getId() };
  const classKeys = schema.listClassKeys();
  if (classKeys.length > 0) {
    schemaDef.classes = {};
    for (const classKey of classKeys) {
      const classDef = _writeClassDef(schema.getClass(classKey));
      schemaDef.classes[classKey] = classDef;
    }
  }
  const enumKeys = schema.listEnumKeys();
  if (enumKeys.length > 0) {
    schemaDef.enums = {};
    for (const enumKey of enumKeys) {
      const enumDef = _writeEnumDef(schema.getEnum(enumKey));
      schemaDef.enums[enumKey] = enumDef;
    }
  }
  if (schema.getName()) schemaDef.name = schema.getName();
  if (schema.getDescription()) schemaDef.description = schema.getDescription();
  if (schema.getVersion()) schemaDef.version = schema.getVersion();
  return schemaDef;
}
function _writeClassDef(classObject) {
  const classDef = {};
  const propertyKeys = classObject.listPropertyKeys();
  if (propertyKeys.length > 0) {
    classDef.properties = {};
    for (const propertyKey of propertyKeys) {
      const propertyObject = classObject.getProperty(propertyKey);
      classDef.properties[propertyKey] = _writeClassPropertyDef(propertyObject);
    }
  }
  if (classObject.getName()) classDef.name = classObject.getName();
  if (classObject.getDescription()) classDef.description = classObject.getDescription();
  return classDef;
}
function _writeClassPropertyDef(classProperty) {
  const classPropertyDef = { type: classProperty.getType() };
  if (classProperty.getArray()) classPropertyDef.array = classProperty.getArray();
  if (classProperty.getNormalized()) classPropertyDef.normalized = classProperty.getNormalized();
  if (classProperty.getRequired()) classPropertyDef.required = classProperty.getRequired();
  if (classProperty.getName()) classPropertyDef.name = classProperty.getName();
  if (classProperty.getDescription()) classPropertyDef.description = classProperty.getDescription();
  if (classProperty.getComponentType() != null) classPropertyDef.componentType = classProperty.getComponentType();
  if (classProperty.getEnumType() != null) classPropertyDef.enumType = classProperty.getEnumType();
  if (classProperty.getCount() != null) classPropertyDef.count = classProperty.getCount();
  if (classProperty.getOffset() != null) classPropertyDef.offset = classProperty.getOffset();
  if (classProperty.getScale() != null) classPropertyDef.scale = classProperty.getScale();
  if (classProperty.getMax() != null) classPropertyDef.max = classProperty.getMax();
  if (classProperty.getMin() != null) classPropertyDef.min = classProperty.getMin();
  if (classProperty.getNoData() != null) classPropertyDef.noData = classProperty.getNoData();
  if (classProperty.getDefault() != null) classPropertyDef.default = classProperty.getDefault();
  return classPropertyDef;
}
function _writeEnumDef(enumObject) {
  const enumDef = { values: enumObject.listValues().map(_writeEnumValueDef) };
  if (enumObject.getName()) enumDef.name = enumObject.getName();
  if (enumObject.getDescription()) enumDef.description = enumObject.getDescription();
  if (enumObject.getValueType() !== "UINT16") enumDef.valueType = enumObject.getValueType();
  return enumDef;
}
function _writeEnumValueDef(enumValue) {
  const enumValueDef = {
    name: enumValue.getName(),
    value: enumValue.getValue()
  };
  if (enumValue.getDescription()) enumValueDef.description = enumValue.getDescription();
  return enumValueDef;
}
function _writePropertyTableDef(context, propertyTable) {
  const propertyTableDef = {
    class: propertyTable.getClass(),
    count: propertyTable.getCount()
  };
  if (propertyTable.getName()) propertyTableDef.name = propertyTable.getName();
  const propertyKeys = propertyTable.listPropertyKeys();
  if (propertyKeys.length > 0) {
    propertyTableDef.properties = {};
    for (const propertyKey of propertyKeys) {
      const propertyTablePropertyDef = _writePropertyTablePropertyDef(context, propertyTable.getProperty(propertyKey));
      propertyTableDef.properties[propertyKey] = propertyTablePropertyDef;
    }
  }
  return propertyTableDef;
}
function _writePropertyTablePropertyDef(context, propertyTableProperty) {
  const values = propertyTableProperty.getValues();
  const propertyTablePropertyDef = { values: context.otherBufferViewsIndexMap.get(values) };
  if (propertyTableProperty.getArrayOffsets()) {
    const arrayOffsets = propertyTableProperty.getArrayOffsets();
    propertyTablePropertyDef.arrayOffsets = context.otherBufferViewsIndexMap.get(arrayOffsets);
  }
  if (propertyTableProperty.getStringOffsets()) {
    const stringOffsets = propertyTableProperty.getStringOffsets();
    propertyTablePropertyDef.stringOffsets = context.otherBufferViewsIndexMap.get(stringOffsets);
  }
  if (propertyTableProperty.getArrayOffsetType() != null) propertyTablePropertyDef.arrayOffsetType = propertyTableProperty.getArrayOffsetType();
  if (propertyTableProperty.getStringOffsetType() != null) propertyTablePropertyDef.stringOffsetType = propertyTableProperty.getStringOffsetType();
  if (propertyTableProperty.getOffset() != null) propertyTablePropertyDef.offset = propertyTableProperty.getOffset();
  if (propertyTableProperty.getScale() != null) propertyTablePropertyDef.scale = propertyTableProperty.getScale();
  if (propertyTableProperty.getMax() != null) propertyTablePropertyDef.max = propertyTableProperty.getMax();
  if (propertyTableProperty.getMin() != null) propertyTablePropertyDef.min = propertyTableProperty.getMin();
  return propertyTablePropertyDef;
}
function _writePropertyAttributeDef(propertyAttribute) {
  const propertyAttributeDef = { class: propertyAttribute.getClass() };
  if (propertyAttribute.getName()) propertyAttributeDef.name = propertyAttribute.getName();
  const propertyKeys = propertyAttribute.listPropertyKeys();
  if (propertyKeys.length > 0) {
    propertyAttributeDef.properties = {};
    for (const propertyKey of propertyKeys) {
      const propertyAttributePropertyDef = _writePropertyAttributePropertyDef(propertyAttribute.getProperty(propertyKey));
      propertyAttributeDef.properties[propertyKey] = propertyAttributePropertyDef;
    }
  }
  return propertyAttributeDef;
}
function _writePropertyAttributePropertyDef(propertyAttributeProperty) {
  const propertyAttributePropertyDef = { attribute: propertyAttributeProperty.getAttribute() };
  if (propertyAttributeProperty.getOffset() != null) propertyAttributePropertyDef.offset = propertyAttributeProperty.getOffset();
  if (propertyAttributeProperty.getScale() != null) propertyAttributePropertyDef.scale = propertyAttributeProperty.getScale();
  if (propertyAttributeProperty.getMax() != null) propertyAttributePropertyDef.max = propertyAttributeProperty.getMax();
  if (propertyAttributeProperty.getMin() != null) propertyAttributePropertyDef.min = propertyAttributeProperty.getMin();
  return propertyAttributePropertyDef;
}
function _writePropertyTextureDef(context, propertyTexture) {
  const propertyTextureDef = { class: propertyTexture.getClass() };
  if (propertyTexture.getName()) propertyTextureDef.name = propertyTexture.getName();
  const propertyKeys = propertyTexture.listPropertyKeys();
  if (propertyKeys.length > 0) {
    propertyTextureDef.properties = {};
    for (const propertyKey of propertyKeys) {
      const propertyTexturePropertyDef = _writePropertyTexturePropertyDef(context, propertyTexture.getProperty(propertyKey));
      propertyTextureDef.properties[propertyKey] = propertyTexturePropertyDef;
    }
  }
  return propertyTextureDef;
}
function _writePropertyTexturePropertyDef(context, propertyTextureProperty) {
  const texture = propertyTextureProperty.getTexture();
  const textureInfo = propertyTextureProperty.getTextureInfo();
  const channels = propertyTextureProperty.getChannels();
  const textureInfoDef = context.createTextureInfoDef(texture, textureInfo);
  if (!MathUtils.eq(channels, [0])) textureInfoDef.channels = channels;
  if (propertyTextureProperty.getOffset() != null) textureInfoDef.offset = propertyTextureProperty.getOffset();
  if (propertyTextureProperty.getScale() != null) textureInfoDef.scale = propertyTextureProperty.getScale();
  if (propertyTextureProperty.getMax() != null) textureInfoDef.max = propertyTextureProperty.getMax();
  if (propertyTextureProperty.getMin() != null) textureInfoDef.min = propertyTextureProperty.getMin();
  return textureInfoDef;
}
function getBufferViewData(context, bufferViewIndex) {
  const jsonDoc = context.jsonDoc;
  const bufferDefs = jsonDoc.json.buffers || [];
  const bufferViewDef = (jsonDoc.json.bufferViews || [])[bufferViewIndex];
  const bufferDef = bufferDefs[bufferViewDef.buffer];
  const bufferData = bufferDef.uri ? jsonDoc.resources[bufferDef.uri] : jsonDoc.resources[GLB_BUFFER];
  const byteOffset = bufferViewDef.byteOffset || 0;
  const byteLength = bufferViewDef.byteLength;
  return bufferData.slice(byteOffset, byteOffset + byteLength);
}
function getOrCreateOtherBufferViews(document, context) {
  const buffer = document.getRoot().listBuffers()[0];
  let otherBufferViews = context.otherBufferViews.get(buffer);
  if (!otherBufferViews) {
    otherBufferViews = [];
    context.otherBufferViews.set(buffer, otherBufferViews);
  }
  return otherBufferViews;
}
var AVIFImageUtils = class {
  match(array) {
    return array.length >= 12 && BufferUtils.decodeText(array.slice(4, 12)) === "ftypavif";
  }
  /**
  * Probes size of AVIF or HEIC image. Assumes a single static image, without
  * orientation or other metadata that would affect dimensions.
  */
  getSize(array) {
    if (!this.match(array)) return null;
    const view = new DataView(array.buffer, array.byteOffset, array.byteLength);
    let box = unbox(view, 0);
    if (!box) return null;
    let offset = box.end;
    while (box = unbox(view, offset)) if (box.type === "meta") offset = box.start + 4;
    else if (box.type === "iprp" || box.type === "ipco") offset = box.start;
    else if (box.type === "ispe") return [view.getUint32(box.start + 4), view.getUint32(box.start + 8)];
    else if (box.type === "mdat") break;
    else offset = box.end;
    return null;
  }
  getChannels(_buffer) {
    return 4;
  }
};
var EXTTextureAVIF = class extends Extension {
  extensionName = EXT_TEXTURE_AVIF;
  /** @hidden */
  prereadTypes = [PropertyType.TEXTURE];
  static EXTENSION_NAME = EXT_TEXTURE_AVIF;
  /** @hidden */
  static register() {
    ImageUtils.registerFormat("image/avif", new AVIFImageUtils());
  }
  /** @hidden */
  preread(context) {
    (context.jsonDoc.json.textures || []).forEach((textureDef) => {
      if (textureDef.extensions && textureDef.extensions["EXT_texture_avif"]) textureDef.source = textureDef.extensions[EXT_TEXTURE_AVIF].source;
    });
    return this;
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listTextures().forEach((texture) => {
      if (texture.getMimeType() === "image/avif") {
        const imageIndex = context.imageIndexMap.get(texture);
        (jsonDoc.json.textures || []).forEach((textureDef) => {
          if (textureDef.source === imageIndex) {
            textureDef.extensions = textureDef.extensions || {};
            textureDef.extensions[EXT_TEXTURE_AVIF] = { source: textureDef.source };
            delete textureDef.source;
          }
        });
      }
    });
    return this;
  }
};
function unbox(data, offset) {
  if (data.byteLength < 4 + offset) return null;
  const size = data.getUint32(offset);
  if (data.byteLength < size + offset || size < 8) return null;
  return {
    type: BufferUtils.decodeText(new Uint8Array(data.buffer, data.byteOffset + offset + 4, 4)),
    start: offset + 8,
    end: offset + size
  };
}
var WEBPImageUtils = class {
  match(array) {
    return array.length >= 12 && array[8] === 87 && array[9] === 69 && array[10] === 66 && array[11] === 80;
  }
  getSize(array) {
    const RIFF = BufferUtils.decodeText(array.slice(0, 4));
    const WEBP = BufferUtils.decodeText(array.slice(8, 12));
    if (RIFF !== "RIFF" || WEBP !== "WEBP") return null;
    const view = new DataView(array.buffer, array.byteOffset);
    let offset = 12;
    while (offset < view.byteLength) {
      const chunkId = BufferUtils.decodeText(new Uint8Array([
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      ]));
      const chunkByteLength = view.getUint32(offset + 4, true);
      if (chunkId === "VP8 ") return [view.getInt16(offset + 14, true) & 16383, view.getInt16(offset + 16, true) & 16383];
      else if (chunkId === "VP8L") {
        const b0 = view.getUint8(offset + 9);
        const b1 = view.getUint8(offset + 10);
        const b2 = view.getUint8(offset + 11);
        const b3 = view.getUint8(offset + 12);
        return [1 + ((b1 & 63) << 8 | b0), 1 + ((b3 & 15) << 10 | b2 << 2 | (b1 & 192) >> 6)];
      }
      offset += 8 + chunkByteLength + chunkByteLength % 2;
    }
    return null;
  }
  getChannels(_buffer) {
    return 4;
  }
};
var EXTTextureWebP = class extends Extension {
  extensionName = EXT_TEXTURE_WEBP;
  /** @hidden */
  prereadTypes = [PropertyType.TEXTURE];
  static EXTENSION_NAME = EXT_TEXTURE_WEBP;
  /** @hidden */
  static register() {
    ImageUtils.registerFormat("image/webp", new WEBPImageUtils());
  }
  /** @hidden */
  preread(context) {
    (context.jsonDoc.json.textures || []).forEach((textureDef) => {
      if (textureDef.extensions && textureDef.extensions["EXT_texture_webp"]) textureDef.source = textureDef.extensions[EXT_TEXTURE_WEBP].source;
    });
    return this;
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listTextures().forEach((texture) => {
      if (texture.getMimeType() === "image/webp") {
        const imageIndex = context.imageIndexMap.get(texture);
        (jsonDoc.json.textures || []).forEach((textureDef) => {
          if (textureDef.source === imageIndex) {
            textureDef.extensions = textureDef.extensions || {};
            textureDef.extensions[EXT_TEXTURE_WEBP] = { source: textureDef.source };
            delete textureDef.source;
          }
        });
      }
    });
    return this;
  }
};
var NAME$1 = KHR_ACCESSOR_FLOAT16;
var KHRAccessorFloat16 = class extends Extension {
  extensionName = NAME$1;
  static EXTENSION_NAME = NAME$1;
  /** @hidden */
  read(_) {
    return this;
  }
  /** @hidden */
  write(_) {
    return this;
  }
};
var NAME = KHR_ACCESSOR_FLOAT64;
var KHRAccessorFloat64 = class extends Extension {
  extensionName = NAME;
  static EXTENSION_NAME = NAME;
  /** @hidden */
  read(_) {
    return this;
  }
  /** @hidden */
  write(_) {
    return this;
  }
};
var decoderModule;
var COMPONENT_ARRAY;
var DATA_TYPE;
function decodeGeometry(decoder, data) {
  const buffer = new decoderModule.DecoderBuffer();
  try {
    buffer.Init(data, data.length);
    if (decoder.GetEncodedGeometryType(buffer) !== decoderModule.TRIANGULAR_MESH) throw new Error(`[${KHR_DRACO_MESH_COMPRESSION}] Unknown geometry type.`);
    const dracoMesh = new decoderModule.Mesh();
    if (!decoder.DecodeBufferToMesh(buffer, dracoMesh).ok() || dracoMesh.ptr === 0) throw new Error(`[${KHR_DRACO_MESH_COMPRESSION}] Decoding failure.`);
    return dracoMesh;
  } finally {
    decoderModule.destroy(buffer);
  }
}
function decodeIndex(decoder, mesh) {
  const numIndices = mesh.num_faces() * 3;
  let ptr;
  let indices;
  if (mesh.num_points() <= 65534) {
    const byteLength = numIndices * Uint16Array.BYTES_PER_ELEMENT;
    ptr = decoderModule._malloc(byteLength);
    decoder.GetTrianglesUInt16Array(mesh, byteLength, ptr);
    indices = new Uint16Array(decoderModule.HEAPU16.buffer, ptr, numIndices).slice();
  } else {
    const byteLength = numIndices * Uint32Array.BYTES_PER_ELEMENT;
    ptr = decoderModule._malloc(byteLength);
    decoder.GetTrianglesUInt32Array(mesh, byteLength, ptr);
    indices = new Uint32Array(decoderModule.HEAPU32.buffer, ptr, numIndices).slice();
  }
  decoderModule._free(ptr);
  return indices;
}
function decodeAttribute(decoder, mesh, attribute, accessorDef) {
  const dataType = DATA_TYPE[accessorDef.componentType];
  const ArrayCtor = COMPONENT_ARRAY[accessorDef.componentType];
  const numComponents = attribute.num_components();
  const numValues = mesh.num_points() * numComponents;
  const byteLength = numValues * ArrayCtor.BYTES_PER_ELEMENT;
  const ptr = decoderModule._malloc(byteLength);
  decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, dataType, byteLength, ptr);
  const array = new ArrayCtor(decoderModule.HEAPF32.buffer, ptr, numValues).slice();
  decoderModule._free(ptr);
  return array;
}
function initDecoderModule(_decoderModule) {
  decoderModule = _decoderModule;
  COMPONENT_ARRAY = {
    [Accessor.ComponentType.FLOAT]: Float32Array,
    [Accessor.ComponentType.UNSIGNED_INT]: Uint32Array,
    [Accessor.ComponentType.UNSIGNED_SHORT]: Uint16Array,
    [Accessor.ComponentType.UNSIGNED_BYTE]: Uint8Array,
    [Accessor.ComponentType.SHORT]: Int16Array,
    [Accessor.ComponentType.BYTE]: Int8Array
  };
  DATA_TYPE = {
    [Accessor.ComponentType.FLOAT]: decoderModule.DT_FLOAT32,
    [Accessor.ComponentType.UNSIGNED_INT]: decoderModule.DT_UINT32,
    [Accessor.ComponentType.UNSIGNED_SHORT]: decoderModule.DT_UINT16,
    [Accessor.ComponentType.UNSIGNED_BYTE]: decoderModule.DT_UINT8,
    [Accessor.ComponentType.SHORT]: decoderModule.DT_INT16,
    [Accessor.ComponentType.BYTE]: decoderModule.DT_INT8
  };
}
var encoderModule;
var EncoderMethod = /* @__PURE__ */ (function(EncoderMethod2) {
  EncoderMethod2[EncoderMethod2["EDGEBREAKER"] = 1] = "EDGEBREAKER";
  EncoderMethod2[EncoderMethod2["SEQUENTIAL"] = 0] = "SEQUENTIAL";
  return EncoderMethod2;
})({});
var DEFAULT_QUANTIZATION_BITS = {
  ["POSITION"]: 14,
  ["NORMAL"]: 10,
  ["COLOR"]: 8,
  ["TEX_COORD"]: 12,
  ["GENERIC"]: 12
};
var DEFAULT_ENCODER_OPTIONS = {
  decodeSpeed: 5,
  encodeSpeed: 5,
  method: 1,
  quantizationBits: DEFAULT_QUANTIZATION_BITS,
  quantizationVolume: "mesh"
};
function initEncoderModule(_encoderModule) {
  encoderModule = _encoderModule;
}
function encodeGeometry(prim, _options = DEFAULT_ENCODER_OPTIONS) {
  const options = {
    ...DEFAULT_ENCODER_OPTIONS,
    ..._options
  };
  options.quantizationBits = {
    ...DEFAULT_QUANTIZATION_BITS,
    ..._options.quantizationBits
  };
  const builder = new encoderModule.MeshBuilder();
  const mesh = new encoderModule.Mesh();
  const encoder = new encoderModule.ExpertEncoder(mesh);
  const attributeIDs = {};
  const dracoBuffer = new encoderModule.DracoInt8Array();
  const hasMorphTargets = prim.listTargets().length > 0;
  let hasSparseAttributes = false;
  for (const semantic of prim.listSemantics()) {
    const attribute = prim.getAttribute(semantic);
    if (attribute.getSparse()) {
      hasSparseAttributes = true;
      continue;
    }
    const attributeEnum = getAttributeEnum(semantic);
    const attributeID = addAttribute(builder, attribute.getComponentType(), mesh, encoderModule[attributeEnum], attribute.getCount(), attribute.getElementSize(), attribute.getArray());
    if (attributeID === -1) throw new Error(`Error compressing "${semantic}" attribute.`);
    attributeIDs[semantic] = attributeID;
    if (options.quantizationVolume === "mesh" || semantic !== "POSITION") encoder.SetAttributeQuantization(attributeID, options.quantizationBits[attributeEnum]);
    else if (typeof options.quantizationVolume === "object") {
      const { quantizationVolume } = options;
      const range = Math.max(quantizationVolume.max[0] - quantizationVolume.min[0], quantizationVolume.max[1] - quantizationVolume.min[1], quantizationVolume.max[2] - quantizationVolume.min[2]);
      encoder.SetAttributeExplicitQuantization(attributeID, options.quantizationBits[attributeEnum], attribute.getElementSize(), quantizationVolume.min, range);
    } else throw new Error("Invalid quantization volume state.");
  }
  const indices = prim.getIndices();
  if (!indices) throw new EncodingError("Primitive must have indices.");
  builder.AddFacesToMesh(mesh, indices.getCount() / 3, indices.getArray());
  encoder.SetSpeedOptions(options.encodeSpeed, options.decodeSpeed);
  encoder.SetTrackEncodedProperties(true);
  if (options.method === 0 || hasMorphTargets || hasSparseAttributes) encoder.SetEncodingMethod(encoderModule.MESH_SEQUENTIAL_ENCODING);
  else encoder.SetEncodingMethod(encoderModule.MESH_EDGEBREAKER_ENCODING);
  const byteLength = encoder.EncodeToDracoBuffer(!(hasMorphTargets || hasSparseAttributes), dracoBuffer);
  if (byteLength <= 0) throw new EncodingError("Error applying Draco compression.");
  const data = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; ++i) data[i] = dracoBuffer.GetValue(i);
  const numVertices = encoder.GetNumberOfEncodedPoints();
  const numIndices = encoder.GetNumberOfEncodedFaces() * 3;
  encoderModule.destroy(dracoBuffer);
  encoderModule.destroy(mesh);
  encoderModule.destroy(builder);
  encoderModule.destroy(encoder);
  return {
    numVertices,
    numIndices,
    data,
    attributeIDs
  };
}
function getAttributeEnum(semantic) {
  if (semantic === "POSITION") return "POSITION";
  else if (semantic === "NORMAL") return "NORMAL";
  else if (semantic.startsWith("COLOR_")) return "COLOR";
  else if (semantic.startsWith("TEXCOORD_")) return "TEX_COORD";
  return "GENERIC";
}
function addAttribute(builder, componentType, mesh, attribute, count, itemSize, array) {
  switch (componentType) {
    case Accessor.ComponentType.UNSIGNED_BYTE:
      return builder.AddUInt8Attribute(mesh, attribute, count, itemSize, array);
    case Accessor.ComponentType.BYTE:
      return builder.AddInt8Attribute(mesh, attribute, count, itemSize, array);
    case Accessor.ComponentType.UNSIGNED_SHORT:
      return builder.AddUInt16Attribute(mesh, attribute, count, itemSize, array);
    case Accessor.ComponentType.SHORT:
      return builder.AddInt16Attribute(mesh, attribute, count, itemSize, array);
    case Accessor.ComponentType.UNSIGNED_INT:
      return builder.AddUInt32Attribute(mesh, attribute, count, itemSize, array);
    case Accessor.ComponentType.FLOAT:
      return builder.AddFloatAttribute(mesh, attribute, count, itemSize, array);
    default:
      throw new Error(`Unexpected component type, "${componentType}".`);
  }
}
var EncodingError = class extends Error {
};
var KHRDracoMeshCompression = class extends Extension {
  extensionName = KHR_DRACO_MESH_COMPRESSION;
  /** @hidden */
  prereadTypes = [PropertyType.PRIMITIVE];
  /** @hidden */
  prewriteTypes = [PropertyType.ACCESSOR];
  /** @hidden */
  readDependencies = ["draco3d.decoder"];
  /** @hidden */
  writeDependencies = ["draco3d.encoder"];
  static EXTENSION_NAME = KHR_DRACO_MESH_COMPRESSION;
  /**
  * Compression method. `EncoderMethod.EDGEBREAKER` usually provides a higher compression ratio,
  * while `EncoderMethod.SEQUENTIAL` better preserves original vertex order.
  */
  static EncoderMethod = EncoderMethod;
  _decoderModule = null;
  _encoderModule = null;
  _encoderOptions = {};
  /** @hidden */
  install(key, dependency) {
    if (key === "draco3d.decoder") {
      this._decoderModule = dependency;
      initDecoderModule(this._decoderModule);
    }
    if (key === "draco3d.encoder") {
      this._encoderModule = dependency;
      initEncoderModule(this._encoderModule);
    }
    return this;
  }
  /**
  * Sets Draco compression options. Compression does not take effect until the Document is
  * written with an I/O class.
  *
  * Defaults:
  * ```
  * decodeSpeed?: number = 5;
  * encodeSpeed?: number = 5;
  * method?: EncoderMethod = EncoderMethod.EDGEBREAKER;
  * quantizationBits?: {[ATTRIBUTE_NAME]: bits};
  * quantizationVolume?: 'mesh' | 'scene' | bbox = 'mesh';
  * ```
  */
  setEncoderOptions(options) {
    this._encoderOptions = options;
    return this;
  }
  /** @hidden */
  preread(context) {
    if (!this._decoderModule) throw new Error(`[${KHR_DRACO_MESH_COMPRESSION}] Please install extension dependency, "draco3d.decoder".`);
    const logger = this.document.getLogger();
    const jsonDoc = context.jsonDoc;
    const dracoMeshes = /* @__PURE__ */ new Map();
    try {
      const meshDefs = jsonDoc.json.meshes || [];
      for (const meshDef of meshDefs) for (const primDef of meshDef.primitives) {
        if (!primDef.extensions || !primDef.extensions["KHR_draco_mesh_compression"]) continue;
        const dracoDef = primDef.extensions[KHR_DRACO_MESH_COMPRESSION];
        let [decoder, dracoMesh] = dracoMeshes.get(dracoDef.bufferView) || [];
        if (!dracoMesh || !decoder) {
          const bufferViewDef = jsonDoc.json.bufferViews[dracoDef.bufferView];
          const bufferDef = jsonDoc.json.buffers[bufferViewDef.buffer];
          const resource = bufferDef.uri ? jsonDoc.resources[bufferDef.uri] : jsonDoc.resources[GLB_BUFFER];
          const byteOffset = bufferViewDef.byteOffset || 0;
          const byteLength = bufferViewDef.byteLength;
          const compressedData = BufferUtils.toView(resource, byteOffset, byteLength);
          decoder = new this._decoderModule.Decoder();
          dracoMesh = decodeGeometry(decoder, compressedData);
          dracoMeshes.set(dracoDef.bufferView, [decoder, dracoMesh]);
          logger.debug(`[${KHR_DRACO_MESH_COMPRESSION}] Decompressed ${compressedData.byteLength} bytes.`);
        }
        for (const semantic in dracoDef.attributes) {
          const accessorDef = context.jsonDoc.json.accessors[primDef.attributes[semantic]];
          const dracoAttribute = decoder.GetAttributeByUniqueId(dracoMesh, dracoDef.attributes[semantic]);
          const attributeArray = decodeAttribute(decoder, dracoMesh, dracoAttribute, accessorDef);
          context.accessors[primDef.attributes[semantic]].setArray(attributeArray);
        }
        if (primDef.indices !== void 0) context.accessors[primDef.indices].setArray(decodeIndex(decoder, dracoMesh));
      }
    } finally {
      for (const [decoder, dracoMesh] of Array.from(dracoMeshes.values())) {
        this._decoderModule.destroy(decoder);
        this._decoderModule.destroy(dracoMesh);
      }
    }
    return this;
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  prewrite(context, _propertyType) {
    if (!this._encoderModule) throw new Error(`[${KHR_DRACO_MESH_COMPRESSION}] Please install extension dependency, "draco3d.encoder".`);
    const logger = this.document.getLogger();
    logger.debug(`[${KHR_DRACO_MESH_COMPRESSION}] Compression options: ${JSON.stringify(this._encoderOptions)}`);
    const primitiveHashMap = listDracoPrimitives(this.document);
    const primitiveEncodingMap = /* @__PURE__ */ new Map();
    let quantizationVolume = "mesh";
    if (this._encoderOptions.quantizationVolume === "scene") {
      if (this.document.getRoot().listScenes().length !== 1) logger.warn(`[${KHR_DRACO_MESH_COMPRESSION}]: quantizationVolume=scene requires exactly 1 scene.`);
      else quantizationVolume = getBounds(this.document.getRoot().listScenes().pop());
    }
    for (const prim of Array.from(primitiveHashMap.keys())) {
      const primHash = primitiveHashMap.get(prim);
      if (!primHash) throw new Error("Unexpected primitive.");
      if (primitiveEncodingMap.has(primHash)) {
        primitiveEncodingMap.set(primHash, primitiveEncodingMap.get(primHash));
        continue;
      }
      const indices = prim.getIndices();
      const accessorDefs = context.jsonDoc.json.accessors;
      let encodedPrim;
      try {
        encodedPrim = encodeGeometry(prim, {
          ...this._encoderOptions,
          quantizationVolume
        });
      } catch (e) {
        if (e instanceof EncodingError) {
          logger.warn(`[${KHR_DRACO_MESH_COMPRESSION}]: ${e.message} Skipping primitive compression.`);
          continue;
        }
        throw e;
      }
      primitiveEncodingMap.set(primHash, encodedPrim);
      const indicesDef = context.createAccessorDef(indices);
      indicesDef.count = encodedPrim.numIndices;
      context.accessorIndexMap.set(indices, accessorDefs.length);
      accessorDefs.push(indicesDef);
      if (encodedPrim.numVertices > 65534 && Accessor.getComponentSize(indicesDef.componentType) <= 2) indicesDef.componentType = Accessor.ComponentType.UNSIGNED_INT;
      else if (encodedPrim.numVertices > 254 && Accessor.getComponentSize(indicesDef.componentType) <= 1) indicesDef.componentType = Accessor.ComponentType.UNSIGNED_SHORT;
      for (const semantic of prim.listSemantics()) {
        const attribute = prim.getAttribute(semantic);
        if (encodedPrim.attributeIDs[semantic] === void 0) continue;
        const attributeDef = context.createAccessorDef(attribute);
        attributeDef.count = encodedPrim.numVertices;
        context.accessorIndexMap.set(attribute, accessorDefs.length);
        accessorDefs.push(attributeDef);
      }
      const buffer = prim.getAttribute("POSITION").getBuffer() || this.document.getRoot().listBuffers()[0];
      if (!context.otherBufferViews.has(buffer)) context.otherBufferViews.set(buffer, []);
      context.otherBufferViews.get(buffer).push(encodedPrim.data);
    }
    logger.debug(`[${KHR_DRACO_MESH_COMPRESSION}] Compressed ${primitiveHashMap.size} primitives.`);
    context.extensionData[KHR_DRACO_MESH_COMPRESSION] = {
      primitiveHashMap,
      primitiveEncodingMap
    };
    return this;
  }
  /** @hidden */
  write(context) {
    const dracoContext = context.extensionData[KHR_DRACO_MESH_COMPRESSION];
    for (const mesh of this.document.getRoot().listMeshes()) {
      const meshDef = context.jsonDoc.json.meshes[context.meshIndexMap.get(mesh)];
      for (let i = 0; i < mesh.listPrimitives().length; i++) {
        const prim = mesh.listPrimitives()[i];
        const primDef = meshDef.primitives[i];
        const primHash = dracoContext.primitiveHashMap.get(prim);
        if (!primHash) continue;
        const encodedPrim = dracoContext.primitiveEncodingMap.get(primHash);
        if (!encodedPrim) continue;
        primDef.extensions = primDef.extensions || {};
        primDef.extensions[KHR_DRACO_MESH_COMPRESSION] = {
          bufferView: context.otherBufferViewsIndexMap.get(encodedPrim.data),
          attributes: encodedPrim.attributeIDs
        };
      }
    }
    if (!dracoContext.primitiveHashMap.size) {
      const json = context.jsonDoc.json;
      json.extensionsUsed = (json.extensionsUsed || []).filter((name) => name !== KHR_DRACO_MESH_COMPRESSION);
      json.extensionsRequired = (json.extensionsRequired || []).filter((name) => name !== KHR_DRACO_MESH_COMPRESSION);
    }
    return this;
  }
};
function listDracoPrimitives(doc) {
  const logger = doc.getLogger();
  const included = /* @__PURE__ */ new Set();
  const excluded = /* @__PURE__ */ new Set();
  let nonIndexed = 0;
  let nonTriangles = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) if (!prim.getIndices()) {
    excluded.add(prim);
    nonIndexed++;
  } else if (prim.getMode() !== Primitive.Mode.TRIANGLES) {
    excluded.add(prim);
    nonTriangles++;
  } else included.add(prim);
  if (nonIndexed > 0) logger.warn(`[${KHR_DRACO_MESH_COMPRESSION}] Skipping Draco compression of ${nonIndexed} non-indexed primitives.`);
  if (nonTriangles > 0) logger.warn(`[${KHR_DRACO_MESH_COMPRESSION}] Skipping Draco compression of ${nonTriangles} non-TRIANGLES primitives.`);
  const accessors = doc.getRoot().listAccessors();
  const accessorIndices = /* @__PURE__ */ new Map();
  for (let i = 0; i < accessors.length; i++) accessorIndices.set(accessors[i], i);
  const includedAccessors = /* @__PURE__ */ new Map();
  const includedHashKeys = /* @__PURE__ */ new Set();
  const primToHashKey = /* @__PURE__ */ new Map();
  for (const prim of Array.from(included)) {
    let hashKey = createHashKey(prim, accessorIndices);
    if (includedHashKeys.has(hashKey)) {
      primToHashKey.set(prim, hashKey);
      continue;
    }
    if (includedAccessors.has(prim.getIndices())) {
      const indices = prim.getIndices();
      const dstIndices = indices.clone();
      accessorIndices.set(dstIndices, doc.getRoot().listAccessors().length - 1);
      prim.swap(indices, dstIndices);
    }
    for (const attribute of prim.listAttributes()) if (includedAccessors.has(attribute)) {
      const dstAttribute = attribute.clone();
      accessorIndices.set(dstAttribute, doc.getRoot().listAccessors().length - 1);
      prim.swap(attribute, dstAttribute);
    }
    hashKey = createHashKey(prim, accessorIndices);
    includedHashKeys.add(hashKey);
    primToHashKey.set(prim, hashKey);
    includedAccessors.set(prim.getIndices(), hashKey);
    for (const attribute of prim.listAttributes()) includedAccessors.set(attribute, hashKey);
  }
  for (const accessor of Array.from(includedAccessors.keys())) {
    const parentTypes = new Set(accessor.listParents().map((prop) => prop.propertyType));
    if (parentTypes.size !== 2 || !parentTypes.has(PropertyType.PRIMITIVE) || !parentTypes.has(PropertyType.ROOT)) throw new Error(`[${KHR_DRACO_MESH_COMPRESSION}] Compressed accessors must only be used as indices or vertex attributes.`);
  }
  for (const prim of Array.from(included)) {
    const hashKey = primToHashKey.get(prim);
    const indices = prim.getIndices();
    if (includedAccessors.get(indices) !== hashKey || prim.listAttributes().some((attr) => includedAccessors.get(attr) !== hashKey)) throw new Error(`[${KHR_DRACO_MESH_COMPRESSION}] Draco primitives must share all, or no, accessors.`);
  }
  for (const prim of Array.from(excluded)) {
    const indices = prim.getIndices();
    if (includedAccessors.has(indices) || prim.listAttributes().some((attr) => includedAccessors.has(attr))) throw new Error(`[${KHR_DRACO_MESH_COMPRESSION}] Accessor cannot be shared by compressed and uncompressed primitives.`);
  }
  return primToHashKey;
}
function createHashKey(prim, indexMap) {
  const hashElements = [];
  const indices = prim.getIndices();
  hashElements.push(indexMap.get(indices));
  for (const attribute of prim.listAttributes()) hashElements.push(indexMap.get(attribute));
  return hashElements.sort().join("|");
}
var Light = class Light2 extends ExtensionProperty {
  static EXTENSION_NAME = KHR_LIGHTS_PUNCTUAL;
  /**********************************************************************************************
  * CONSTANTS.
  */
  static Type = {
    POINT: "point",
    SPOT: "spot",
    DIRECTIONAL: "directional"
  };
  /**********************************************************************************************
  * INSTANCE.
  */
  init() {
    this.extensionName = KHR_LIGHTS_PUNCTUAL;
    this.propertyType = "Light";
    this.parentTypes = [PropertyType.NODE];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      color: [
        1,
        1,
        1
      ],
      intensity: 1,
      type: Light2.Type.POINT,
      range: null,
      innerConeAngle: 0,
      outerConeAngle: Math.PI / 4
    });
  }
  /**********************************************************************************************
  * COLOR.
  */
  /** Light color; Linear-sRGB components. */
  getColor() {
    return this.get("color");
  }
  /** Light color; Linear-sRGB components. */
  setColor(color) {
    return this.set("color", color);
  }
  /**********************************************************************************************
  * INTENSITY.
  */
  /**
  * Brightness of light. Units depend on the type of light: point and spot lights use luminous
  * intensity in candela (lm/sr) while directional lights use illuminance in lux (lm/m2).
  */
  getIntensity() {
    return this.get("intensity");
  }
  /**
  * Brightness of light. Units depend on the type of light: point and spot lights use luminous
  * intensity in candela (lm/sr) while directional lights use illuminance in lux (lm/m2).
  */
  setIntensity(intensity) {
    return this.set("intensity", intensity);
  }
  /**********************************************************************************************
  * TYPE.
  */
  /** Type. */
  getType() {
    return this.get("type");
  }
  /** Type. */
  setType(type) {
    return this.set("type", type);
  }
  /**********************************************************************************************
  * RANGE.
  */
  /**
  * Hint defining a distance cutoff at which the light's intensity may be considered to have
  * reached zero. Supported only for point and spot lights. Must be > 0. When undefined, range
  * is assumed to be infinite.
  */
  getRange() {
    return this.get("range");
  }
  /**
  * Hint defining a distance cutoff at which the light's intensity may be considered to have
  * reached zero. Supported only for point and spot lights. Must be > 0. When undefined, range
  * is assumed to be infinite.
  */
  setRange(range) {
    return this.set("range", range);
  }
  /**********************************************************************************************
  * SPOT LIGHT PROPERTIES
  */
  /**
  * Angle, in radians, from centre of spotlight where falloff begins. Must be >= 0 and
  * < outerConeAngle.
  */
  getInnerConeAngle() {
    return this.get("innerConeAngle");
  }
  /**
  * Angle, in radians, from centre of spotlight where falloff begins. Must be >= 0 and
  * < outerConeAngle.
  */
  setInnerConeAngle(angle) {
    return this.set("innerConeAngle", angle);
  }
  /**
  * Angle, in radians, from centre of spotlight where falloff ends. Must be > innerConeAngle and
  * <= PI / 2.0.
  */
  getOuterConeAngle() {
    return this.get("outerConeAngle");
  }
  /**
  * Angle, in radians, from centre of spotlight where falloff ends. Must be > innerConeAngle and
  * <= PI / 2.0.
  */
  setOuterConeAngle(angle) {
    return this.set("outerConeAngle", angle);
  }
};
var KHRLightsPunctual = class extends Extension {
  extensionName = KHR_LIGHTS_PUNCTUAL;
  static EXTENSION_NAME = KHR_LIGHTS_PUNCTUAL;
  /** Creates a new punctual Light property for use on a {@link Node}. */
  createLight(name = "") {
    return new Light(this.document.getGraph(), name);
  }
  /** @hidden */
  read(context) {
    const jsonDoc = context.jsonDoc;
    if (!jsonDoc.json.extensions || !jsonDoc.json.extensions["KHR_lights_punctual"]) return this;
    const lights = (jsonDoc.json.extensions["KHR_lights_punctual"].lights || []).map((lightDef) => {
      const light = this.createLight().setName(lightDef.name || "").setType(lightDef.type);
      if (lightDef.extras) light.setExtras(lightDef.extras);
      if (lightDef.color !== void 0) light.setColor(lightDef.color);
      if (lightDef.intensity !== void 0) light.setIntensity(lightDef.intensity);
      if (lightDef.range !== void 0) light.setRange(lightDef.range);
      if (lightDef.spot?.innerConeAngle !== void 0) light.setInnerConeAngle(lightDef.spot.innerConeAngle);
      if (lightDef.spot?.outerConeAngle !== void 0) light.setOuterConeAngle(lightDef.spot.outerConeAngle);
      return light;
    });
    jsonDoc.json.nodes.forEach((nodeDef, nodeIndex) => {
      if (!nodeDef.extensions || !nodeDef.extensions["KHR_lights_punctual"]) return;
      const lightNodeDef = nodeDef.extensions[KHR_LIGHTS_PUNCTUAL];
      context.nodes[nodeIndex].setExtension(KHR_LIGHTS_PUNCTUAL, lights[lightNodeDef.light]);
    });
    return this;
  }
  /** @hidden */
  write(context) {
    const jsonDoc = context.jsonDoc;
    if (this.properties.size === 0) return this;
    const lightDefs = [];
    const lightIndexMap = /* @__PURE__ */ new Map();
    for (const property of this.properties) {
      const light = property;
      const lightDef = context.createPropertyDef(property);
      lightDef.type = light.getType();
      if (!MathUtils.eq(light.getColor(), [
        1,
        1,
        1
      ])) lightDef.color = light.getColor();
      if (light.getIntensity() !== 1) lightDef.intensity = light.getIntensity();
      if (light.getRange() != null) lightDef.range = light.getRange();
      if (light.getName()) lightDef.name = light.getName();
      if (light.getType() === Light.Type.SPOT) lightDef.spot = {
        innerConeAngle: light.getInnerConeAngle(),
        outerConeAngle: light.getOuterConeAngle()
      };
      lightDefs.push(lightDef);
      lightIndexMap.set(light, lightDefs.length - 1);
    }
    this.document.getRoot().listNodes().forEach((node) => {
      const light = node.getExtension(KHR_LIGHTS_PUNCTUAL);
      if (light) {
        const nodeIndex = context.nodeIndexMap.get(node);
        const nodeDef = jsonDoc.json.nodes[nodeIndex];
        nodeDef.extensions = nodeDef.extensions || {};
        nodeDef.extensions[KHR_LIGHTS_PUNCTUAL] = { light: lightIndexMap.get(light) };
      }
    });
    jsonDoc.json.extensions = jsonDoc.json.extensions || {};
    jsonDoc.json.extensions[KHR_LIGHTS_PUNCTUAL] = { lights: lightDefs };
    return this;
  }
};
var { R: R$7, G: G$7, B: B$5 } = TextureChannel;
var Anisotropy = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_ANISOTROPY;
  init() {
    this.extensionName = KHR_MATERIALS_ANISOTROPY;
    this.propertyType = "Anisotropy";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      anisotropyStrength: 0,
      anisotropyRotation: 0,
      anisotropyTexture: null,
      anisotropyTextureInfo: new TextureInfo(this.graph, "anisotropyTextureInfo")
    });
  }
  /**********************************************************************************************
  * Anisotropy strength.
  */
  /** Anisotropy strength. */
  getAnisotropyStrength() {
    return this.get("anisotropyStrength");
  }
  /** Anisotropy strength. */
  setAnisotropyStrength(strength) {
    return this.set("anisotropyStrength", strength);
  }
  /**********************************************************************************************
  * Anisotropy rotation.
  */
  /** Anisotropy rotation; linear multiplier. */
  getAnisotropyRotation() {
    return this.get("anisotropyRotation");
  }
  /** Anisotropy rotation; linear multiplier. */
  setAnisotropyRotation(rotation) {
    return this.set("anisotropyRotation", rotation);
  }
  /**********************************************************************************************
  * Anisotropy texture.
  */
  /**
  * Anisotropy texture. Red and green channels represent the anisotropy
  * direction in [-1, 1] tangent, bitangent space, to be rotated by
  * anisotropyRotation. The blue channel contains strength as [0, 1] to be
  * multiplied by anisotropyStrength.
  */
  getAnisotropyTexture() {
    return this.getRef("anisotropyTexture");
  }
  /**
  * Settings affecting the material's use of its anisotropy texture. If no
  * texture is attached, {@link TextureInfo} is `null`.
  */
  getAnisotropyTextureInfo() {
    return this.getRef("anisotropyTexture") ? this.getRef("anisotropyTextureInfo") : null;
  }
  /** Anisotropy texture. See {@link Anisotropy.getAnisotropyTexture getAnisotropyTexture}. */
  setAnisotropyTexture(texture) {
    return this.setRef("anisotropyTexture", texture, { channels: R$7 | G$7 | B$5 });
  }
};
var KHRMaterialsAnisotropy = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_ANISOTROPY;
  extensionName = KHR_MATERIALS_ANISOTROPY;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new Anisotropy property for use on a {@link Material}. */
  createAnisotropy() {
    return new Anisotropy(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    const jsonDoc = context.jsonDoc;
    const materialDefs = jsonDoc.json.materials || [];
    const textureDefs = jsonDoc.json.textures || [];
    materialDefs.forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_anisotropy"]) {
        const anisotropy = this.createAnisotropy();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_ANISOTROPY, anisotropy);
        const anisotropyDef = materialDef.extensions[KHR_MATERIALS_ANISOTROPY];
        if (anisotropyDef.extras) anisotropy.setExtras(anisotropyDef.extras);
        if (anisotropyDef.anisotropyStrength !== void 0) anisotropy.setAnisotropyStrength(anisotropyDef.anisotropyStrength);
        if (anisotropyDef.anisotropyRotation !== void 0) anisotropy.setAnisotropyRotation(anisotropyDef.anisotropyRotation);
        if (anisotropyDef.anisotropyTexture !== void 0) {
          const textureInfoDef = anisotropyDef.anisotropyTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          anisotropy.setAnisotropyTexture(texture);
          context.setTextureInfo(anisotropy.getAnisotropyTextureInfo(), textureInfoDef);
        }
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const anisotropy = material.getExtension(KHR_MATERIALS_ANISOTROPY);
      if (anisotropy) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const anisotropyDef = context.createPropertyDef(anisotropy);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_ANISOTROPY] = anisotropyDef;
        if (anisotropy.getAnisotropyStrength() > 0) anisotropyDef.anisotropyStrength = anisotropy.getAnisotropyStrength();
        if (anisotropy.getAnisotropyRotation() !== 0) anisotropyDef.anisotropyRotation = anisotropy.getAnisotropyRotation();
        if (anisotropy.getAnisotropyTexture()) {
          const texture = anisotropy.getAnisotropyTexture();
          const textureInfo = anisotropy.getAnisotropyTextureInfo();
          anisotropyDef.anisotropyTexture = context.createTextureInfoDef(texture, textureInfo);
        }
      }
    });
    return this;
  }
};
var { R: R$6, G: G$6, B: B$4 } = TextureChannel;
var Clearcoat = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_CLEARCOAT;
  init() {
    this.extensionName = KHR_MATERIALS_CLEARCOAT;
    this.propertyType = "Clearcoat";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      clearcoatFactor: 0,
      clearcoatTexture: null,
      clearcoatTextureInfo: new TextureInfo(this.graph, "clearcoatTextureInfo"),
      clearcoatRoughnessFactor: 0,
      clearcoatRoughnessTexture: null,
      clearcoatRoughnessTextureInfo: new TextureInfo(this.graph, "clearcoatRoughnessTextureInfo"),
      clearcoatNormalScale: 1,
      clearcoatNormalTexture: null,
      clearcoatNormalTextureInfo: new TextureInfo(this.graph, "clearcoatNormalTextureInfo")
    });
  }
  /**********************************************************************************************
  * Clearcoat.
  */
  /** Clearcoat; linear multiplier. See {@link Clearcoat.getClearcoatTexture getClearcoatTexture}. */
  getClearcoatFactor() {
    return this.get("clearcoatFactor");
  }
  /** Clearcoat; linear multiplier. See {@link Clearcoat.getClearcoatTexture getClearcoatTexture}. */
  setClearcoatFactor(factor) {
    return this.set("clearcoatFactor", factor);
  }
  /**
  * Clearcoat texture; linear multiplier. The `r` channel of this texture specifies an amount
  * [0-1] of coating over the surface of the material, which may have its own roughness and
  * normal map properties.
  */
  getClearcoatTexture() {
    return this.getRef("clearcoatTexture");
  }
  /**
  * Settings affecting the material's use of its clearcoat texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getClearcoatTextureInfo() {
    return this.getRef("clearcoatTexture") ? this.getRef("clearcoatTextureInfo") : null;
  }
  /** Sets clearcoat texture. See {@link Clearcoat.getClearcoatTexture getClearcoatTexture}. */
  setClearcoatTexture(texture) {
    return this.setRef("clearcoatTexture", texture, { channels: R$6 });
  }
  /**********************************************************************************************
  * Clearcoat roughness.
  */
  /**
  * Clearcoat roughness; linear multiplier.
  * See {@link Clearcoat.getClearcoatRoughnessTexture getClearcoatRoughnessTexture}.
  */
  getClearcoatRoughnessFactor() {
    return this.get("clearcoatRoughnessFactor");
  }
  /**
  * Clearcoat roughness; linear multiplier.
  * See {@link Clearcoat.getClearcoatRoughnessTexture getClearcoatRoughnessTexture}.
  */
  setClearcoatRoughnessFactor(factor) {
    return this.set("clearcoatRoughnessFactor", factor);
  }
  /**
  * Clearcoat roughness texture; linear multiplier. The `g` channel of this texture specifies
  * roughness, independent of the base layer's roughness.
  */
  getClearcoatRoughnessTexture() {
    return this.getRef("clearcoatRoughnessTexture");
  }
  /**
  * Settings affecting the material's use of its clearcoat roughness texture. If no texture is
  * attached, {@link TextureInfo} is `null`.
  */
  getClearcoatRoughnessTextureInfo() {
    return this.getRef("clearcoatRoughnessTexture") ? this.getRef("clearcoatRoughnessTextureInfo") : null;
  }
  /**
  * Sets clearcoat roughness texture.
  * See {@link Clearcoat.getClearcoatRoughnessTexture getClearcoatRoughnessTexture}.
  */
  setClearcoatRoughnessTexture(texture) {
    return this.setRef("clearcoatRoughnessTexture", texture, { channels: G$6 });
  }
  /**********************************************************************************************
  * Clearcoat normals.
  */
  /** Clearcoat normal scale. See {@link Clearcoat.getClearcoatNormalTexture getClearcoatNormalTexture}. */
  getClearcoatNormalScale() {
    return this.get("clearcoatNormalScale");
  }
  /** Clearcoat normal scale. See {@link Clearcoat.getClearcoatNormalTexture getClearcoatNormalTexture}. */
  setClearcoatNormalScale(scale) {
    return this.set("clearcoatNormalScale", scale);
  }
  /**
  * Clearcoat normal map. Independent of the material base layer normal map.
  */
  getClearcoatNormalTexture() {
    return this.getRef("clearcoatNormalTexture");
  }
  /**
  * Settings affecting the material's use of its clearcoat normal texture. If no texture is
  * attached, {@link TextureInfo} is `null`.
  */
  getClearcoatNormalTextureInfo() {
    return this.getRef("clearcoatNormalTexture") ? this.getRef("clearcoatNormalTextureInfo") : null;
  }
  /** Sets clearcoat normal texture. See {@link Clearcoat.getClearcoatNormalTexture getClearcoatNormalTexture}. */
  setClearcoatNormalTexture(texture) {
    return this.setRef("clearcoatNormalTexture", texture, { channels: R$6 | G$6 | B$4 });
  }
};
var KHRMaterialsClearcoat = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_CLEARCOAT;
  extensionName = KHR_MATERIALS_CLEARCOAT;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new Clearcoat property for use on a {@link Material}. */
  createClearcoat() {
    return new Clearcoat(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    const jsonDoc = context.jsonDoc;
    const materialDefs = jsonDoc.json.materials || [];
    const textureDefs = jsonDoc.json.textures || [];
    materialDefs.forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_clearcoat"]) {
        const clearcoat = this.createClearcoat();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_CLEARCOAT, clearcoat);
        const clearcoatDef = materialDef.extensions[KHR_MATERIALS_CLEARCOAT];
        if (clearcoatDef.extras) clearcoat.setExtras(clearcoatDef.extras);
        if (clearcoatDef.clearcoatFactor !== void 0) clearcoat.setClearcoatFactor(clearcoatDef.clearcoatFactor);
        if (clearcoatDef.clearcoatRoughnessFactor !== void 0) clearcoat.setClearcoatRoughnessFactor(clearcoatDef.clearcoatRoughnessFactor);
        if (clearcoatDef.clearcoatTexture !== void 0) {
          const textureInfoDef = clearcoatDef.clearcoatTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          clearcoat.setClearcoatTexture(texture);
          context.setTextureInfo(clearcoat.getClearcoatTextureInfo(), textureInfoDef);
        }
        if (clearcoatDef.clearcoatRoughnessTexture !== void 0) {
          const textureInfoDef = clearcoatDef.clearcoatRoughnessTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          clearcoat.setClearcoatRoughnessTexture(texture);
          context.setTextureInfo(clearcoat.getClearcoatRoughnessTextureInfo(), textureInfoDef);
        }
        if (clearcoatDef.clearcoatNormalTexture !== void 0) {
          const textureInfoDef = clearcoatDef.clearcoatNormalTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          clearcoat.setClearcoatNormalTexture(texture);
          context.setTextureInfo(clearcoat.getClearcoatNormalTextureInfo(), textureInfoDef);
          if (textureInfoDef.scale !== void 0) clearcoat.setClearcoatNormalScale(textureInfoDef.scale);
        }
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const clearcoat = material.getExtension(KHR_MATERIALS_CLEARCOAT);
      if (clearcoat) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const clearcoatDef = context.createPropertyDef(clearcoat);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_CLEARCOAT] = clearcoatDef;
        clearcoatDef.clearcoatFactor = clearcoat.getClearcoatFactor();
        clearcoatDef.clearcoatRoughnessFactor = clearcoat.getClearcoatRoughnessFactor();
        if (clearcoat.getClearcoatTexture()) {
          const texture = clearcoat.getClearcoatTexture();
          const textureInfo = clearcoat.getClearcoatTextureInfo();
          clearcoatDef.clearcoatTexture = context.createTextureInfoDef(texture, textureInfo);
        }
        if (clearcoat.getClearcoatRoughnessTexture()) {
          const texture = clearcoat.getClearcoatRoughnessTexture();
          const textureInfo = clearcoat.getClearcoatRoughnessTextureInfo();
          clearcoatDef.clearcoatRoughnessTexture = context.createTextureInfoDef(texture, textureInfo);
        }
        if (clearcoat.getClearcoatNormalTexture()) {
          const texture = clearcoat.getClearcoatNormalTexture();
          const textureInfo = clearcoat.getClearcoatNormalTextureInfo();
          clearcoatDef.clearcoatNormalTexture = context.createTextureInfoDef(texture, textureInfo);
          if (clearcoat.getClearcoatNormalScale() !== 1) clearcoatDef.clearcoatNormalTexture.scale = clearcoat.getClearcoatNormalScale();
        }
      }
    });
    return this;
  }
};
var { R: R$5, G: G$5, B: B$3, A: A$3 } = TextureChannel;
var DiffuseTransmission = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_DIFFUSE_TRANSMISSION;
  init() {
    this.extensionName = KHR_MATERIALS_DIFFUSE_TRANSMISSION;
    this.propertyType = "DiffuseTransmission";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      diffuseTransmissionFactor: 0,
      diffuseTransmissionTexture: null,
      diffuseTransmissionTextureInfo: new TextureInfo(this.graph, "diffuseTransmissionTextureInfo"),
      diffuseTransmissionColorFactor: [
        1,
        1,
        1
      ],
      diffuseTransmissionColorTexture: null,
      diffuseTransmissionColorTextureInfo: new TextureInfo(this.graph, "diffuseTransmissionColorTextureInfo")
    });
  }
  /**********************************************************************************************
  * Diffuse transmission.
  */
  /**
  * Percentage of reflected, non-specularly reflected light that is transmitted through the
  * surface via the Lambertian diffuse transmission, i.e., the strength of the diffuse
  * transmission effect.
  */
  getDiffuseTransmissionFactor() {
    return this.get("diffuseTransmissionFactor");
  }
  /**
  * Percentage of reflected, non-specularly reflected light that is transmitted through the
  * surface via the Lambertian diffuse transmission, i.e., the strength of the diffuse
  * transmission effect.
  */
  setDiffuseTransmissionFactor(factor) {
    return this.set("diffuseTransmissionFactor", factor);
  }
  /**
  * Texture that defines the strength of the diffuse transmission effect, stored in the alpha (A)
  * channel. Will be multiplied by the diffuseTransmissionFactor.
  */
  getDiffuseTransmissionTexture() {
    return this.getRef("diffuseTransmissionTexture");
  }
  /**
  * Settings affecting the material's use of its diffuse transmission texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getDiffuseTransmissionTextureInfo() {
    return this.getRef("diffuseTransmissionTexture") ? this.getRef("diffuseTransmissionTextureInfo") : null;
  }
  /**
  * Texture that defines the strength of the diffuse transmission effect, stored in the alpha (A)
  * channel. Will be multiplied by the diffuseTransmissionFactor.
  */
  setDiffuseTransmissionTexture(texture) {
    return this.setRef("diffuseTransmissionTexture", texture, { channels: A$3 });
  }
  /**********************************************************************************************
  * Diffuse transmission color.
  */
  /** Color of the transmitted light; Linear-sRGB components. */
  getDiffuseTransmissionColorFactor() {
    return this.get("diffuseTransmissionColorFactor");
  }
  /** Color of the transmitted light; Linear-sRGB components. */
  setDiffuseTransmissionColorFactor(factor) {
    return this.set("diffuseTransmissionColorFactor", factor);
  }
  /**
  * Texture that defines the color of the transmitted light, stored in the RGB channels and
  * encoded in sRGB. This texture will be multiplied by diffuseTransmissionColorFactor.
  */
  getDiffuseTransmissionColorTexture() {
    return this.getRef("diffuseTransmissionColorTexture");
  }
  /**
  * Settings affecting the material's use of its diffuse transmission color texture. If no
  * texture is attached, {@link TextureInfo} is `null`.
  */
  getDiffuseTransmissionColorTextureInfo() {
    return this.getRef("diffuseTransmissionColorTexture") ? this.getRef("diffuseTransmissionColorTextureInfo") : null;
  }
  /**
  * Texture that defines the color of the transmitted light, stored in the RGB channels and
  * encoded in sRGB. This texture will be multiplied by diffuseTransmissionColorFactor.
  */
  setDiffuseTransmissionColorTexture(texture) {
    return this.setRef("diffuseTransmissionColorTexture", texture, { channels: R$5 | G$5 | B$3 });
  }
};
var KHRMaterialsDiffuseTransmission = class extends Extension {
  extensionName = KHR_MATERIALS_DIFFUSE_TRANSMISSION;
  static EXTENSION_NAME = KHR_MATERIALS_DIFFUSE_TRANSMISSION;
  /** Creates a new DiffuseTransmission property for use on a {@link Material}. */
  createDiffuseTransmission() {
    return new DiffuseTransmission(this.document.getGraph());
  }
  /** @hidden */
  read(context) {
    const jsonDoc = context.jsonDoc;
    const materialDefs = jsonDoc.json.materials || [];
    const textureDefs = jsonDoc.json.textures || [];
    materialDefs.forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_diffuse_transmission"]) {
        const transmission = this.createDiffuseTransmission();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_DIFFUSE_TRANSMISSION, transmission);
        const transmissionDef = materialDef.extensions[KHR_MATERIALS_DIFFUSE_TRANSMISSION];
        if (transmissionDef.extras) transmission.setExtras(transmissionDef.extras);
        if (transmissionDef.diffuseTransmissionFactor !== void 0) transmission.setDiffuseTransmissionFactor(transmissionDef.diffuseTransmissionFactor);
        if (transmissionDef.diffuseTransmissionColorFactor !== void 0) transmission.setDiffuseTransmissionColorFactor(transmissionDef.diffuseTransmissionColorFactor);
        if (transmissionDef.diffuseTransmissionTexture !== void 0) {
          const textureInfoDef = transmissionDef.diffuseTransmissionTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          transmission.setDiffuseTransmissionTexture(texture);
          context.setTextureInfo(transmission.getDiffuseTransmissionTextureInfo(), textureInfoDef);
        }
        if (transmissionDef.diffuseTransmissionColorTexture !== void 0) {
          const textureInfoDef = transmissionDef.diffuseTransmissionColorTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          transmission.setDiffuseTransmissionColorTexture(texture);
          context.setTextureInfo(transmission.getDiffuseTransmissionColorTextureInfo(), textureInfoDef);
        }
      }
    });
    return this;
  }
  /** @hidden */
  write(context) {
    const jsonDoc = context.jsonDoc;
    for (const material of this.document.getRoot().listMaterials()) {
      const transmission = material.getExtension(KHR_MATERIALS_DIFFUSE_TRANSMISSION);
      if (!transmission) continue;
      const materialIndex = context.materialIndexMap.get(material);
      const materialDef = jsonDoc.json.materials[materialIndex];
      const transmissionDef = context.createPropertyDef(transmission);
      materialDef.extensions = materialDef.extensions || {};
      materialDef.extensions[KHR_MATERIALS_DIFFUSE_TRANSMISSION] = transmissionDef;
      transmissionDef.diffuseTransmissionFactor = transmission.getDiffuseTransmissionFactor();
      transmissionDef.diffuseTransmissionColorFactor = transmission.getDiffuseTransmissionColorFactor();
      if (transmission.getDiffuseTransmissionTexture()) {
        const texture = transmission.getDiffuseTransmissionTexture();
        const textureInfo = transmission.getDiffuseTransmissionTextureInfo();
        transmissionDef.diffuseTransmissionTexture = context.createTextureInfoDef(texture, textureInfo);
      }
      if (transmission.getDiffuseTransmissionColorTexture()) {
        const texture = transmission.getDiffuseTransmissionColorTexture();
        const textureInfo = transmission.getDiffuseTransmissionColorTextureInfo();
        transmissionDef.diffuseTransmissionColorTexture = context.createTextureInfoDef(texture, textureInfo);
      }
    }
    return this;
  }
};
var Dispersion = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_DISPERSION;
  init() {
    this.extensionName = KHR_MATERIALS_DISPERSION;
    this.propertyType = "Dispersion";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { dispersion: 0 });
  }
  /**********************************************************************************************
  * Dispersion.
  */
  /** Dispersion. */
  getDispersion() {
    return this.get("dispersion");
  }
  /** Dispersion. */
  setDispersion(dispersion) {
    return this.set("dispersion", dispersion);
  }
};
var KHRMaterialsDispersion = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_DISPERSION;
  extensionName = KHR_MATERIALS_DISPERSION;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new Dispersion property for use on a {@link Material}. */
  createDispersion() {
    return new Dispersion(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    (context.jsonDoc.json.materials || []).forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_dispersion"]) {
        const dispersion = this.createDispersion();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_DISPERSION, dispersion);
        const dispersionDef = materialDef.extensions[KHR_MATERIALS_DISPERSION];
        if (dispersionDef.extras) dispersion.setExtras(dispersionDef.extras);
        if (dispersionDef.dispersion !== void 0) dispersion.setDispersion(dispersionDef.dispersion);
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const dispersion = material.getExtension(KHR_MATERIALS_DISPERSION);
      if (dispersion) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const dispersionDef = context.createPropertyDef(dispersion);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_DISPERSION] = dispersionDef;
        dispersionDef.dispersion = dispersion.getDispersion();
      }
    });
    return this;
  }
};
var EmissiveStrength = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_EMISSIVE_STRENGTH;
  init() {
    this.extensionName = KHR_MATERIALS_EMISSIVE_STRENGTH;
    this.propertyType = "EmissiveStrength";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { emissiveStrength: 1 });
  }
  /**********************************************************************************************
  * EmissiveStrength.
  */
  /** EmissiveStrength. */
  getEmissiveStrength() {
    return this.get("emissiveStrength");
  }
  /** EmissiveStrength. */
  setEmissiveStrength(strength) {
    return this.set("emissiveStrength", strength);
  }
};
var KHRMaterialsEmissiveStrength = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_EMISSIVE_STRENGTH;
  extensionName = KHR_MATERIALS_EMISSIVE_STRENGTH;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new EmissiveStrength property for use on a {@link Material}. */
  createEmissiveStrength() {
    return new EmissiveStrength(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    (context.jsonDoc.json.materials || []).forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_emissive_strength"]) {
        const emissiveStrength = this.createEmissiveStrength();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_EMISSIVE_STRENGTH, emissiveStrength);
        const emissiveStrengthDef = materialDef.extensions[KHR_MATERIALS_EMISSIVE_STRENGTH];
        if (emissiveStrengthDef.extras) emissiveStrength.setExtras(emissiveStrengthDef.extras);
        if (emissiveStrengthDef.emissiveStrength !== void 0) emissiveStrength.setEmissiveStrength(emissiveStrengthDef.emissiveStrength);
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const emissiveStrength = material.getExtension(KHR_MATERIALS_EMISSIVE_STRENGTH);
      if (emissiveStrength) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const emissiveStrengthDef = context.createPropertyDef(emissiveStrength);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_EMISSIVE_STRENGTH] = emissiveStrengthDef;
        emissiveStrengthDef.emissiveStrength = emissiveStrength.getEmissiveStrength();
      }
    });
    return this;
  }
};
var IOR = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_IOR;
  init() {
    this.extensionName = KHR_MATERIALS_IOR;
    this.propertyType = "IOR";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { ior: 1.5 });
  }
  /**********************************************************************************************
  * IOR.
  */
  /** IOR. */
  getIOR() {
    return this.get("ior");
  }
  /** IOR. */
  setIOR(ior) {
    return this.set("ior", ior);
  }
};
var KHRMaterialsIOR = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_IOR;
  extensionName = KHR_MATERIALS_IOR;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new IOR property for use on a {@link Material}. */
  createIOR() {
    return new IOR(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    (context.jsonDoc.json.materials || []).forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_ior"]) {
        const ior = this.createIOR();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_IOR, ior);
        const iorDef = materialDef.extensions[KHR_MATERIALS_IOR];
        if (iorDef.extras) ior.setExtras(iorDef.extras);
        if (iorDef.ior !== void 0) ior.setIOR(iorDef.ior);
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const ior = material.getExtension(KHR_MATERIALS_IOR);
      if (ior) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const iorDef = context.createPropertyDef(ior);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_IOR] = iorDef;
        iorDef.ior = ior.getIOR();
      }
    });
    return this;
  }
};
var { R: R$4, G: G$4 } = TextureChannel;
var Iridescence = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_IRIDESCENCE;
  init() {
    this.extensionName = KHR_MATERIALS_IRIDESCENCE;
    this.propertyType = "Iridescence";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      iridescenceFactor: 0,
      iridescenceTexture: null,
      iridescenceTextureInfo: new TextureInfo(this.graph, "iridescenceTextureInfo"),
      iridescenceIOR: 1.3,
      iridescenceThicknessMinimum: 100,
      iridescenceThicknessMaximum: 400,
      iridescenceThicknessTexture: null,
      iridescenceThicknessTextureInfo: new TextureInfo(this.graph, "iridescenceThicknessTextureInfo")
    });
  }
  /**********************************************************************************************
  * Iridescence.
  */
  /** Iridescence; linear multiplier. See {@link Iridescence.getIridescenceTexture getIridescenceTexture}. */
  getIridescenceFactor() {
    return this.get("iridescenceFactor");
  }
  /** Iridescence; linear multiplier. See {@link Iridescence.getIridescenceTexture getIridescenceTexture}. */
  setIridescenceFactor(factor) {
    return this.set("iridescenceFactor", factor);
  }
  /**
  * Iridescence intensity.
  *
  * Only the red (R) channel is used for iridescence intensity, but this texture may optionally
  * be packed with additional data in the other channels.
  */
  getIridescenceTexture() {
    return this.getRef("iridescenceTexture");
  }
  /**
  * Settings affecting the material's use of its iridescence texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getIridescenceTextureInfo() {
    return this.getRef("iridescenceTexture") ? this.getRef("iridescenceTextureInfo") : null;
  }
  /** Iridescence intensity. See {@link Iridescence.getIridescenceTexture getIridescenceTexture}. */
  setIridescenceTexture(texture) {
    return this.setRef("iridescenceTexture", texture, { channels: R$4 });
  }
  /**********************************************************************************************
  * Iridescence IOR.
  */
  /** Index of refraction of the dielectric thin-film layer. */
  getIridescenceIOR() {
    return this.get("iridescenceIOR");
  }
  /** Index of refraction of the dielectric thin-film layer. */
  setIridescenceIOR(ior) {
    return this.set("iridescenceIOR", ior);
  }
  /**********************************************************************************************
  * Iridescence thickness.
  */
  /** Minimum thickness of the thin-film layer, in nanometers (nm). */
  getIridescenceThicknessMinimum() {
    return this.get("iridescenceThicknessMinimum");
  }
  /** Minimum thickness of the thin-film layer, in nanometers (nm). */
  setIridescenceThicknessMinimum(thickness) {
    return this.set("iridescenceThicknessMinimum", thickness);
  }
  /** Maximum thickness of the thin-film layer, in nanometers (nm). */
  getIridescenceThicknessMaximum() {
    return this.get("iridescenceThicknessMaximum");
  }
  /** Maximum thickness of the thin-film layer, in nanometers (nm). */
  setIridescenceThicknessMaximum(thickness) {
    return this.set("iridescenceThicknessMaximum", thickness);
  }
  /**
  * The green channel of this texture defines the thickness of the
  * thin-film layer by blending between the minimum and maximum thickness.
  */
  getIridescenceThicknessTexture() {
    return this.getRef("iridescenceThicknessTexture");
  }
  /**
  * Settings affecting the material's use of its iridescence thickness texture.
  * If no texture is attached, {@link TextureInfo} is `null`.
  */
  getIridescenceThicknessTextureInfo() {
    return this.getRef("iridescenceThicknessTexture") ? this.getRef("iridescenceThicknessTextureInfo") : null;
  }
  /**
  * Sets iridescence thickness texture.
  * See {@link Iridescence.getIridescenceThicknessTexture getIridescenceThicknessTexture}.
  */
  setIridescenceThicknessTexture(texture) {
    return this.setRef("iridescenceThicknessTexture", texture, { channels: G$4 });
  }
};
var KHRMaterialsIridescence = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_IRIDESCENCE;
  extensionName = KHR_MATERIALS_IRIDESCENCE;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new Iridescence property for use on a {@link Material}. */
  createIridescence() {
    return new Iridescence(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    const jsonDoc = context.jsonDoc;
    const materialDefs = jsonDoc.json.materials || [];
    const textureDefs = jsonDoc.json.textures || [];
    materialDefs.forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_iridescence"]) {
        const iridescence = this.createIridescence();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_IRIDESCENCE, iridescence);
        const iridescenceDef = materialDef.extensions[KHR_MATERIALS_IRIDESCENCE];
        if (iridescenceDef.extras) iridescence.setExtras(iridescenceDef.extras);
        if (iridescenceDef.iridescenceFactor !== void 0) iridescence.setIridescenceFactor(iridescenceDef.iridescenceFactor);
        if (iridescenceDef.iridescenceIor !== void 0) iridescence.setIridescenceIOR(iridescenceDef.iridescenceIor);
        if (iridescenceDef.iridescenceThicknessMinimum !== void 0) iridescence.setIridescenceThicknessMinimum(iridescenceDef.iridescenceThicknessMinimum);
        if (iridescenceDef.iridescenceThicknessMaximum !== void 0) iridescence.setIridescenceThicknessMaximum(iridescenceDef.iridescenceThicknessMaximum);
        if (iridescenceDef.iridescenceTexture !== void 0) {
          const textureInfoDef = iridescenceDef.iridescenceTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          iridescence.setIridescenceTexture(texture);
          context.setTextureInfo(iridescence.getIridescenceTextureInfo(), textureInfoDef);
        }
        if (iridescenceDef.iridescenceThicknessTexture !== void 0) {
          const textureInfoDef = iridescenceDef.iridescenceThicknessTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          iridescence.setIridescenceThicknessTexture(texture);
          context.setTextureInfo(iridescence.getIridescenceThicknessTextureInfo(), textureInfoDef);
        }
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const iridescence = material.getExtension(KHR_MATERIALS_IRIDESCENCE);
      if (iridescence) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const iridescenceDef = context.createPropertyDef(iridescence);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_IRIDESCENCE] = iridescenceDef;
        if (iridescence.getIridescenceFactor() > 0) iridescenceDef.iridescenceFactor = iridescence.getIridescenceFactor();
        if (iridescence.getIridescenceIOR() !== 1.3) iridescenceDef.iridescenceIor = iridescence.getIridescenceIOR();
        if (iridescence.getIridescenceThicknessMinimum() !== 100) iridescenceDef.iridescenceThicknessMinimum = iridescence.getIridescenceThicknessMinimum();
        if (iridescence.getIridescenceThicknessMaximum() !== 400) iridescenceDef.iridescenceThicknessMaximum = iridescence.getIridescenceThicknessMaximum();
        if (iridescence.getIridescenceTexture()) {
          const texture = iridescence.getIridescenceTexture();
          const textureInfo = iridescence.getIridescenceTextureInfo();
          iridescenceDef.iridescenceTexture = context.createTextureInfoDef(texture, textureInfo);
        }
        if (iridescence.getIridescenceThicknessTexture()) {
          const texture = iridescence.getIridescenceThicknessTexture();
          const textureInfo = iridescence.getIridescenceThicknessTextureInfo();
          iridescenceDef.iridescenceThicknessTexture = context.createTextureInfoDef(texture, textureInfo);
        }
      }
    });
    return this;
  }
};
var { R: R$3, G: G$3, B: B$2, A: A$2 } = TextureChannel;
var PBRSpecularGlossiness = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS;
  init() {
    this.extensionName = KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS;
    this.propertyType = "PBRSpecularGlossiness";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      diffuseFactor: [
        1,
        1,
        1,
        1
      ],
      diffuseTexture: null,
      diffuseTextureInfo: new TextureInfo(this.graph, "diffuseTextureInfo"),
      specularFactor: [
        1,
        1,
        1
      ],
      glossinessFactor: 1,
      specularGlossinessTexture: null,
      specularGlossinessTextureInfo: new TextureInfo(this.graph, "specularGlossinessTextureInfo")
    });
  }
  /**********************************************************************************************
  * Diffuse.
  */
  /** Diffuse; Linear-sRGB components. See {@link PBRSpecularGlossiness.getDiffuseTexture getDiffuseTexture}. */
  getDiffuseFactor() {
    return this.get("diffuseFactor");
  }
  /** Diffuse; Linear-sRGB components. See {@link PBRSpecularGlossiness.getDiffuseTexture getDiffuseTexture}. */
  setDiffuseFactor(factor) {
    return this.set("diffuseFactor", factor);
  }
  /**
  * Diffuse texture; sRGB. Alternative to baseColorTexture, used within the
  * spec/gloss PBR workflow.
  */
  getDiffuseTexture() {
    return this.getRef("diffuseTexture");
  }
  /**
  * Settings affecting the material's use of its diffuse texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getDiffuseTextureInfo() {
    return this.getRef("diffuseTexture") ? this.getRef("diffuseTextureInfo") : null;
  }
  /** Sets diffuse texture. See {@link PBRSpecularGlossiness.getDiffuseTexture getDiffuseTexture}. */
  setDiffuseTexture(texture) {
    return this.setRef("diffuseTexture", texture, {
      channels: R$3 | G$3 | B$2 | A$2,
      isColor: true
    });
  }
  /**********************************************************************************************
  * Specular.
  */
  /** Specular; linear multiplier. */
  getSpecularFactor() {
    return this.get("specularFactor");
  }
  /** Specular; linear multiplier. */
  setSpecularFactor(factor) {
    return this.set("specularFactor", factor);
  }
  /**********************************************************************************************
  * Glossiness.
  */
  /** Glossiness; linear multiplier. */
  getGlossinessFactor() {
    return this.get("glossinessFactor");
  }
  /** Glossiness; linear multiplier. */
  setGlossinessFactor(factor) {
    return this.set("glossinessFactor", factor);
  }
  /**********************************************************************************************
  * Specular/Glossiness.
  */
  /** Spec/gloss texture; linear multiplier. */
  getSpecularGlossinessTexture() {
    return this.getRef("specularGlossinessTexture");
  }
  /**
  * Settings affecting the material's use of its spec/gloss texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getSpecularGlossinessTextureInfo() {
    return this.getRef("specularGlossinessTexture") ? this.getRef("specularGlossinessTextureInfo") : null;
  }
  /** Spec/gloss texture; linear multiplier. */
  setSpecularGlossinessTexture(texture) {
    return this.setRef("specularGlossinessTexture", texture, { channels: R$3 | G$3 | B$2 | A$2 });
  }
};
var KHRMaterialsPBRSpecularGlossiness = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS;
  extensionName = KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new PBRSpecularGlossiness property for use on a {@link Material}. */
  createPBRSpecularGlossiness() {
    return new PBRSpecularGlossiness(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    const jsonDoc = context.jsonDoc;
    const materialDefs = jsonDoc.json.materials || [];
    const textureDefs = jsonDoc.json.textures || [];
    materialDefs.forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_pbrSpecularGlossiness"]) {
        const specGloss = this.createPBRSpecularGlossiness();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS, specGloss);
        const specGlossDef = materialDef.extensions[KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS];
        if (specGlossDef.extras) specGloss.setExtras(specGlossDef.extras);
        if (specGlossDef.diffuseFactor !== void 0) specGloss.setDiffuseFactor(specGlossDef.diffuseFactor);
        if (specGlossDef.specularFactor !== void 0) specGloss.setSpecularFactor(specGlossDef.specularFactor);
        if (specGlossDef.glossinessFactor !== void 0) specGloss.setGlossinessFactor(specGlossDef.glossinessFactor);
        if (specGlossDef.diffuseTexture !== void 0) {
          const textureInfoDef = specGlossDef.diffuseTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          specGloss.setDiffuseTexture(texture);
          context.setTextureInfo(specGloss.getDiffuseTextureInfo(), textureInfoDef);
        }
        if (specGlossDef.specularGlossinessTexture !== void 0) {
          const textureInfoDef = specGlossDef.specularGlossinessTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          specGloss.setSpecularGlossinessTexture(texture);
          context.setTextureInfo(specGloss.getSpecularGlossinessTextureInfo(), textureInfoDef);
        }
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const specGloss = material.getExtension(KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS);
      if (specGloss) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const specGlossDef = context.createPropertyDef(specGloss);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS] = specGlossDef;
        specGlossDef.diffuseFactor = specGloss.getDiffuseFactor();
        specGlossDef.specularFactor = specGloss.getSpecularFactor();
        specGlossDef.glossinessFactor = specGloss.getGlossinessFactor();
        if (specGloss.getDiffuseTexture()) {
          const texture = specGloss.getDiffuseTexture();
          const textureInfo = specGloss.getDiffuseTextureInfo();
          specGlossDef.diffuseTexture = context.createTextureInfoDef(texture, textureInfo);
        }
        if (specGloss.getSpecularGlossinessTexture()) {
          const texture = specGloss.getSpecularGlossinessTexture();
          const textureInfo = specGloss.getSpecularGlossinessTextureInfo();
          specGlossDef.specularGlossinessTexture = context.createTextureInfoDef(texture, textureInfo);
        }
      }
    });
    return this;
  }
};
var { R: R$2, G: G$2, B: B$1, A: A$1 } = TextureChannel;
var Sheen = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_SHEEN;
  init() {
    this.extensionName = KHR_MATERIALS_SHEEN;
    this.propertyType = "Sheen";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      sheenColorFactor: [
        0,
        0,
        0
      ],
      sheenColorTexture: null,
      sheenColorTextureInfo: new TextureInfo(this.graph, "sheenColorTextureInfo"),
      sheenRoughnessFactor: 0,
      sheenRoughnessTexture: null,
      sheenRoughnessTextureInfo: new TextureInfo(this.graph, "sheenRoughnessTextureInfo")
    });
  }
  /**********************************************************************************************
  * Sheen color.
  */
  /** Sheen; linear multiplier. */
  getSheenColorFactor() {
    return this.get("sheenColorFactor");
  }
  /** Sheen; linear multiplier. */
  setSheenColorFactor(factor) {
    return this.set("sheenColorFactor", factor);
  }
  /**
  * Sheen color texture, in sRGB colorspace.
  */
  getSheenColorTexture() {
    return this.getRef("sheenColorTexture");
  }
  /**
  * Settings affecting the material's use of its sheen color texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getSheenColorTextureInfo() {
    return this.getRef("sheenColorTexture") ? this.getRef("sheenColorTextureInfo") : null;
  }
  /** Sets sheen color texture. See {@link Sheen.getSheenColorTexture getSheenColorTexture}. */
  setSheenColorTexture(texture) {
    return this.setRef("sheenColorTexture", texture, {
      channels: R$2 | G$2 | B$1,
      isColor: true
    });
  }
  /**********************************************************************************************
  * Sheen roughness.
  */
  /** Sheen roughness; linear multiplier. See {@link Sheen.getSheenRoughnessTexture getSheenRoughnessTexture}. */
  getSheenRoughnessFactor() {
    return this.get("sheenRoughnessFactor");
  }
  /** Sheen roughness; linear multiplier. See {@link Sheen.getSheenRoughnessTexture getSheenRoughnessTexture}. */
  setSheenRoughnessFactor(factor) {
    return this.set("sheenRoughnessFactor", factor);
  }
  /**
  * Sheen roughness texture; linear multiplier. The `a` channel of this texture specifies
  * roughness, independent of the base layer's roughness.
  */
  getSheenRoughnessTexture() {
    return this.getRef("sheenRoughnessTexture");
  }
  /**
  * Settings affecting the material's use of its sheen roughness texture. If no texture is
  * attached, {@link TextureInfo} is `null`.
  */
  getSheenRoughnessTextureInfo() {
    return this.getRef("sheenRoughnessTexture") ? this.getRef("sheenRoughnessTextureInfo") : null;
  }
  /**
  * Sets sheen roughness texture.  The `a` channel of this texture specifies
  * roughness, independent of the base layer's roughness.
  */
  setSheenRoughnessTexture(texture) {
    return this.setRef("sheenRoughnessTexture", texture, { channels: A$1 });
  }
};
var KHRMaterialsSheen = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_SHEEN;
  extensionName = KHR_MATERIALS_SHEEN;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new Sheen property for use on a {@link Material}. */
  createSheen() {
    return new Sheen(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    const jsonDoc = context.jsonDoc;
    const materialDefs = jsonDoc.json.materials || [];
    const textureDefs = jsonDoc.json.textures || [];
    materialDefs.forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_sheen"]) {
        const sheen = this.createSheen();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_SHEEN, sheen);
        const sheenDef = materialDef.extensions[KHR_MATERIALS_SHEEN];
        if (sheenDef.extras) sheen.setExtras(sheenDef.extras);
        if (sheenDef.sheenColorFactor !== void 0) sheen.setSheenColorFactor(sheenDef.sheenColorFactor);
        if (sheenDef.sheenRoughnessFactor !== void 0) sheen.setSheenRoughnessFactor(sheenDef.sheenRoughnessFactor);
        if (sheenDef.sheenColorTexture !== void 0) {
          const textureInfoDef = sheenDef.sheenColorTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          sheen.setSheenColorTexture(texture);
          context.setTextureInfo(sheen.getSheenColorTextureInfo(), textureInfoDef);
        }
        if (sheenDef.sheenRoughnessTexture !== void 0) {
          const textureInfoDef = sheenDef.sheenRoughnessTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          sheen.setSheenRoughnessTexture(texture);
          context.setTextureInfo(sheen.getSheenRoughnessTextureInfo(), textureInfoDef);
        }
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const sheen = material.getExtension(KHR_MATERIALS_SHEEN);
      if (sheen) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const sheenDef = context.createPropertyDef(sheen);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_SHEEN] = sheenDef;
        sheenDef.sheenColorFactor = sheen.getSheenColorFactor();
        sheenDef.sheenRoughnessFactor = sheen.getSheenRoughnessFactor();
        if (sheen.getSheenColorTexture()) {
          const texture = sheen.getSheenColorTexture();
          const textureInfo = sheen.getSheenColorTextureInfo();
          sheenDef.sheenColorTexture = context.createTextureInfoDef(texture, textureInfo);
        }
        if (sheen.getSheenRoughnessTexture()) {
          const texture = sheen.getSheenRoughnessTexture();
          const textureInfo = sheen.getSheenRoughnessTextureInfo();
          sheenDef.sheenRoughnessTexture = context.createTextureInfoDef(texture, textureInfo);
        }
      }
    });
    return this;
  }
};
var { R: R$1, G: G$1, B: B2, A: A2 } = TextureChannel;
var Specular = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_SPECULAR;
  init() {
    this.extensionName = KHR_MATERIALS_SPECULAR;
    this.propertyType = "Specular";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      specularFactor: 1,
      specularTexture: null,
      specularTextureInfo: new TextureInfo(this.graph, "specularTextureInfo"),
      specularColorFactor: [
        1,
        1,
        1
      ],
      specularColorTexture: null,
      specularColorTextureInfo: new TextureInfo(this.graph, "specularColorTextureInfo")
    });
  }
  /**********************************************************************************************
  * Specular.
  */
  /** Specular; linear multiplier. See {@link Specular.getSpecularTexture getSpecularTexture}. */
  getSpecularFactor() {
    return this.get("specularFactor");
  }
  /** Specular; linear multiplier. See {@link Specular.getSpecularTexture getSpecularTexture}. */
  setSpecularFactor(factor) {
    return this.set("specularFactor", factor);
  }
  /** Specular color; Linear-sRGB components. See {@link Specular.getSpecularTexture getSpecularTexture}. */
  getSpecularColorFactor() {
    return this.get("specularColorFactor");
  }
  /** Specular color; Linear-sRGB components. See {@link Specular.getSpecularTexture getSpecularTexture}. */
  setSpecularColorFactor(factor) {
    return this.set("specularColorFactor", factor);
  }
  /**
  * Specular texture; linear multiplier. Configures the strength of the specular reflection in
  * the dielectric BRDF. A value of zero disables the specular reflection, resulting in a pure
  * diffuse material.
  *
  * Only the alpha (A) channel is used for specular strength, but this texture may optionally
  * be packed with specular color (RGB) into a single texture.
  */
  getSpecularTexture() {
    return this.getRef("specularTexture");
  }
  /**
  * Settings affecting the material's use of its specular texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getSpecularTextureInfo() {
    return this.getRef("specularTexture") ? this.getRef("specularTextureInfo") : null;
  }
  /** Sets specular texture. See {@link Specular.getSpecularTexture getSpecularTexture}. */
  setSpecularTexture(texture) {
    return this.setRef("specularTexture", texture, { channels: A2 });
  }
  /**
  * Specular color texture; linear multiplier. Defines the F0 color of the specular reflection
  * (RGB channels, encoded in sRGB) in the the dielectric BRDF.
  *
  * Only RGB channels are used here, but this texture may optionally be packed with a specular
  * factor (A) into a single texture.
  */
  getSpecularColorTexture() {
    return this.getRef("specularColorTexture");
  }
  /**
  * Settings affecting the material's use of its specular color texture. If no texture is
  * attached, {@link TextureInfo} is `null`.
  */
  getSpecularColorTextureInfo() {
    return this.getRef("specularColorTexture") ? this.getRef("specularColorTextureInfo") : null;
  }
  /** Sets specular color texture. See {@link Specular.getSpecularColorTexture getSpecularColorTexture}. */
  setSpecularColorTexture(texture) {
    return this.setRef("specularColorTexture", texture, {
      channels: R$1 | G$1 | B2,
      isColor: true
    });
  }
};
var KHRMaterialsSpecular = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_SPECULAR;
  extensionName = KHR_MATERIALS_SPECULAR;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new Specular property for use on a {@link Material}. */
  createSpecular() {
    return new Specular(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    const jsonDoc = context.jsonDoc;
    const materialDefs = jsonDoc.json.materials || [];
    const textureDefs = jsonDoc.json.textures || [];
    materialDefs.forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_specular"]) {
        const specular = this.createSpecular();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_SPECULAR, specular);
        const specularDef = materialDef.extensions[KHR_MATERIALS_SPECULAR];
        if (specularDef.extras) specular.setExtras(specularDef.extras);
        if (specularDef.specularFactor !== void 0) specular.setSpecularFactor(specularDef.specularFactor);
        if (specularDef.specularColorFactor !== void 0) specular.setSpecularColorFactor(specularDef.specularColorFactor);
        if (specularDef.specularTexture !== void 0) {
          const textureInfoDef = specularDef.specularTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          specular.setSpecularTexture(texture);
          context.setTextureInfo(specular.getSpecularTextureInfo(), textureInfoDef);
        }
        if (specularDef.specularColorTexture !== void 0) {
          const textureInfoDef = specularDef.specularColorTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          specular.setSpecularColorTexture(texture);
          context.setTextureInfo(specular.getSpecularColorTextureInfo(), textureInfoDef);
        }
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const specular = material.getExtension(KHR_MATERIALS_SPECULAR);
      if (specular) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const specularDef = context.createPropertyDef(specular);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_SPECULAR] = specularDef;
        if (specular.getSpecularFactor() !== 1) specularDef.specularFactor = specular.getSpecularFactor();
        if (!MathUtils.eq(specular.getSpecularColorFactor(), [
          1,
          1,
          1
        ])) specularDef.specularColorFactor = specular.getSpecularColorFactor();
        if (specular.getSpecularTexture()) {
          const texture = specular.getSpecularTexture();
          const textureInfo = specular.getSpecularTextureInfo();
          specularDef.specularTexture = context.createTextureInfoDef(texture, textureInfo);
        }
        if (specular.getSpecularColorTexture()) {
          const texture = specular.getSpecularColorTexture();
          const textureInfo = specular.getSpecularColorTextureInfo();
          specularDef.specularColorTexture = context.createTextureInfoDef(texture, textureInfo);
        }
      }
    });
    return this;
  }
};
var { R: R2 } = TextureChannel;
var Transmission = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_TRANSMISSION;
  init() {
    this.extensionName = KHR_MATERIALS_TRANSMISSION;
    this.propertyType = "Transmission";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      transmissionFactor: 0,
      transmissionTexture: null,
      transmissionTextureInfo: new TextureInfo(this.graph, "transmissionTextureInfo")
    });
  }
  /**********************************************************************************************
  * Transmission.
  */
  /** Transmission; linear multiplier. See {@link Transmission.getTransmissionTexture getTransmissionTexture}. */
  getTransmissionFactor() {
    return this.get("transmissionFactor");
  }
  /** Transmission; linear multiplier. See {@link Transmission.getTransmissionTexture getTransmissionTexture}. */
  setTransmissionFactor(factor) {
    return this.set("transmissionFactor", factor);
  }
  /**
  * Transmission texture; linear multiplier. The `r` channel of this texture specifies
  * transmission [0-1] of the material's surface. By default this is a thin transparency
  * effect, but volume effects (refraction, subsurface scattering) may be introduced with the
  * addition of the `KHR_materials_volume` extension.
  */
  getTransmissionTexture() {
    return this.getRef("transmissionTexture");
  }
  /**
  * Settings affecting the material's use of its transmission texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getTransmissionTextureInfo() {
    return this.getRef("transmissionTexture") ? this.getRef("transmissionTextureInfo") : null;
  }
  /** Sets transmission texture. See {@link Transmission.getTransmissionTexture getTransmissionTexture}. */
  setTransmissionTexture(texture) {
    return this.setRef("transmissionTexture", texture, { channels: R2 });
  }
};
var KHRMaterialsTransmission = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_TRANSMISSION;
  extensionName = KHR_MATERIALS_TRANSMISSION;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new Transmission property for use on a {@link Material}. */
  createTransmission() {
    return new Transmission(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    const jsonDoc = context.jsonDoc;
    const materialDefs = jsonDoc.json.materials || [];
    const textureDefs = jsonDoc.json.textures || [];
    materialDefs.forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_transmission"]) {
        const transmission = this.createTransmission();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_TRANSMISSION, transmission);
        const transmissionDef = materialDef.extensions[KHR_MATERIALS_TRANSMISSION];
        if (transmissionDef.extras) transmission.setExtras(transmissionDef.extras);
        if (transmissionDef.transmissionFactor !== void 0) transmission.setTransmissionFactor(transmissionDef.transmissionFactor);
        if (transmissionDef.transmissionTexture !== void 0) {
          const textureInfoDef = transmissionDef.transmissionTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          transmission.setTransmissionTexture(texture);
          context.setTextureInfo(transmission.getTransmissionTextureInfo(), textureInfoDef);
        }
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const transmission = material.getExtension(KHR_MATERIALS_TRANSMISSION);
      if (transmission) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const transmissionDef = context.createPropertyDef(transmission);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_TRANSMISSION] = transmissionDef;
        transmissionDef.transmissionFactor = transmission.getTransmissionFactor();
        if (transmission.getTransmissionTexture()) {
          const texture = transmission.getTransmissionTexture();
          const textureInfo = transmission.getTransmissionTextureInfo();
          transmissionDef.transmissionTexture = context.createTextureInfoDef(texture, textureInfo);
        }
      }
    });
    return this;
  }
};
var Unlit = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_UNLIT;
  init() {
    this.extensionName = KHR_MATERIALS_UNLIT;
    this.propertyType = "Unlit";
    this.parentTypes = [PropertyType.MATERIAL];
  }
};
var KHRMaterialsUnlit = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_UNLIT;
  extensionName = KHR_MATERIALS_UNLIT;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new Unlit property for use on a {@link Material}. */
  createUnlit() {
    return new Unlit(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    (context.jsonDoc.json.materials || []).forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_unlit"]) context.materials[materialIndex].setExtension(KHR_MATERIALS_UNLIT, this.createUnlit());
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      if (material.getExtension("KHR_materials_unlit")) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_UNLIT] = {};
      }
    });
    return this;
  }
};
var Mapping = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_VARIANTS;
  init() {
    this.extensionName = KHR_MATERIALS_VARIANTS;
    this.propertyType = "Mapping";
    this.parentTypes = ["MappingList"];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      material: null,
      variants: new RefSet()
    });
  }
  /** The {@link Material} designated for this {@link Primitive}, under the given variants. */
  getMaterial() {
    return this.getRef("material");
  }
  /** The {@link Material} designated for this {@link Primitive}, under the given variants. */
  setMaterial(material) {
    return this.setRef("material", material);
  }
  /** Adds a {@link Variant} to this mapping. */
  addVariant(variant) {
    return this.addRef("variants", variant);
  }
  /** Removes a {@link Variant} from this mapping. */
  removeVariant(variant) {
    return this.removeRef("variants", variant);
  }
  /** Lists {@link Variant}s in this mapping. */
  listVariants() {
    return this.listRefs("variants");
  }
};
var MappingList = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_VARIANTS;
  init() {
    this.extensionName = KHR_MATERIALS_VARIANTS;
    this.propertyType = "MappingList";
    this.parentTypes = [PropertyType.PRIMITIVE];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { mappings: new RefSet() });
  }
  /** Adds a {@link Mapping} to this mapping. */
  addMapping(mapping) {
    return this.addRef("mappings", mapping);
  }
  /** Removes a {@link Mapping} from the list for this {@link Primitive}. */
  removeMapping(mapping) {
    return this.removeRef("mappings", mapping);
  }
  /** Lists {@link Mapping}s in this {@link Primitive}. */
  listMappings() {
    return this.listRefs("mappings");
  }
};
var Variant = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_VARIANTS;
  init() {
    this.extensionName = KHR_MATERIALS_VARIANTS;
    this.propertyType = "Variant";
    this.parentTypes = ["MappingList"];
  }
};
var KHRMaterialsVariants = class extends Extension {
  extensionName = KHR_MATERIALS_VARIANTS;
  static EXTENSION_NAME = KHR_MATERIALS_VARIANTS;
  /** Creates a new MappingList property. */
  createMappingList() {
    return new MappingList(this.document.getGraph());
  }
  /** Creates a new Variant property. */
  createVariant(name = "") {
    return new Variant(this.document.getGraph(), name);
  }
  /** Creates a new Mapping property. */
  createMapping() {
    return new Mapping(this.document.getGraph());
  }
  /** Lists all Variants on the current Document. */
  listVariants() {
    return Array.from(this.properties).filter((prop) => prop instanceof Variant);
  }
  /** @hidden */
  read(context) {
    const jsonDoc = context.jsonDoc;
    if (!jsonDoc.json.extensions || !jsonDoc.json.extensions["KHR_materials_variants"]) return this;
    const variants = (jsonDoc.json.extensions["KHR_materials_variants"].variants || []).map((variantDef) => this.createVariant().setName(variantDef.name || ""));
    (jsonDoc.json.meshes || []).forEach((meshDef, meshIndex) => {
      const mesh = context.meshes[meshIndex];
      (meshDef.primitives || []).forEach((primDef, primIndex) => {
        if (!primDef.extensions || !primDef.extensions["KHR_materials_variants"]) return;
        const mappingList = this.createMappingList();
        const variantPrimDef = primDef.extensions[KHR_MATERIALS_VARIANTS];
        for (const mappingDef of variantPrimDef.mappings) {
          const mapping = this.createMapping();
          if (mappingDef.material !== void 0) mapping.setMaterial(context.materials[mappingDef.material]);
          for (const variantIndex of mappingDef.variants || []) mapping.addVariant(variants[variantIndex]);
          mappingList.addMapping(mapping);
        }
        mesh.listPrimitives()[primIndex].setExtension(KHR_MATERIALS_VARIANTS, mappingList);
      });
    });
    return this;
  }
  /** @hidden */
  write(context) {
    const jsonDoc = context.jsonDoc;
    const variants = this.listVariants();
    if (!variants.length) return this;
    const variantDefs = [];
    const variantIndexMap = /* @__PURE__ */ new Map();
    for (const variant of variants) {
      variantIndexMap.set(variant, variantDefs.length);
      variantDefs.push(context.createPropertyDef(variant));
    }
    for (const mesh of this.document.getRoot().listMeshes()) {
      const meshIndex = context.meshIndexMap.get(mesh);
      mesh.listPrimitives().forEach((prim, primIndex) => {
        const mappingList = prim.getExtension(KHR_MATERIALS_VARIANTS);
        if (!mappingList) return;
        const primDef = context.jsonDoc.json.meshes[meshIndex].primitives[primIndex];
        const mappingDefs = mappingList.listMappings().map((mapping) => {
          const mappingDef = context.createPropertyDef(mapping);
          const material = mapping.getMaterial();
          if (material) mappingDef.material = context.materialIndexMap.get(material);
          mappingDef.variants = mapping.listVariants().map((variant) => variantIndexMap.get(variant));
          return mappingDef;
        });
        primDef.extensions = primDef.extensions || {};
        primDef.extensions[KHR_MATERIALS_VARIANTS] = { mappings: mappingDefs };
      });
    }
    jsonDoc.json.extensions = jsonDoc.json.extensions || {};
    jsonDoc.json.extensions[KHR_MATERIALS_VARIANTS] = { variants: variantDefs };
    return this;
  }
};
var { G: G2 } = TextureChannel;
var Volume = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_MATERIALS_VOLUME;
  init() {
    this.extensionName = KHR_MATERIALS_VOLUME;
    this.propertyType = "Volume";
    this.parentTypes = [PropertyType.MATERIAL];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      thicknessFactor: 0,
      thicknessTexture: null,
      thicknessTextureInfo: new TextureInfo(this.graph, "thicknessTexture"),
      attenuationDistance: Infinity,
      attenuationColor: [
        1,
        1,
        1
      ]
    });
  }
  /**********************************************************************************************
  * Thickness.
  */
  /**
  * Thickness of the volume beneath the surface in meters in the local coordinate system of the
  * node. If the value is 0 the material is thin-walled. Otherwise the material is a volume
  * boundary. The doubleSided property has no effect on volume boundaries.
  */
  getThicknessFactor() {
    return this.get("thicknessFactor");
  }
  /**
  * Thickness of the volume beneath the surface in meters in the local coordinate system of the
  * node. If the value is 0 the material is thin-walled. Otherwise the material is a volume
  * boundary. The doubleSided property has no effect on volume boundaries.
  */
  setThicknessFactor(factor) {
    return this.set("thicknessFactor", factor);
  }
  /**
  * Texture that defines the thickness, stored in the G channel. This will be multiplied by
  * thicknessFactor.
  */
  getThicknessTexture() {
    return this.getRef("thicknessTexture");
  }
  /**
  * Settings affecting the material's use of its thickness texture. If no texture is attached,
  * {@link TextureInfo} is `null`.
  */
  getThicknessTextureInfo() {
    return this.getRef("thicknessTexture") ? this.getRef("thicknessTextureInfo") : null;
  }
  /**
  * Texture that defines the thickness, stored in the G channel. This will be multiplied by
  * thicknessFactor.
  */
  setThicknessTexture(texture) {
    return this.setRef("thicknessTexture", texture, { channels: G2 });
  }
  /**********************************************************************************************
  * Attenuation.
  */
  /**
  * Density of the medium given as the average distance in meters that light travels in the
  * medium before interacting with a particle.
  */
  getAttenuationDistance() {
    return this.get("attenuationDistance");
  }
  /**
  * Density of the medium given as the average distance in meters that light travels in the
  * medium before interacting with a particle.
  */
  setAttenuationDistance(distance) {
    return this.set("attenuationDistance", distance);
  }
  /**
  * Color (linear) that white light turns into due to absorption when reaching the attenuation
  * distance.
  */
  getAttenuationColor() {
    return this.get("attenuationColor");
  }
  /**
  * Color (linear) that white light turns into due to absorption when reaching the attenuation
  * distance.
  */
  setAttenuationColor(color) {
    return this.set("attenuationColor", color);
  }
};
var KHRMaterialsVolume = class extends Extension {
  static EXTENSION_NAME = KHR_MATERIALS_VOLUME;
  extensionName = KHR_MATERIALS_VOLUME;
  prereadTypes = [PropertyType.MESH];
  prewriteTypes = [PropertyType.MESH];
  /** Creates a new Volume property for use on a {@link Material}. */
  createVolume() {
    return new Volume(this.document.getGraph());
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(_context) {
    return this;
  }
  /** @hidden */
  preread(context) {
    const jsonDoc = context.jsonDoc;
    const materialDefs = jsonDoc.json.materials || [];
    const textureDefs = jsonDoc.json.textures || [];
    materialDefs.forEach((materialDef, materialIndex) => {
      if (materialDef.extensions && materialDef.extensions["KHR_materials_volume"]) {
        const volume = this.createVolume();
        context.materials[materialIndex].setExtension(KHR_MATERIALS_VOLUME, volume);
        const volumeDef = materialDef.extensions[KHR_MATERIALS_VOLUME];
        if (volumeDef.extras) volume.setExtras(volumeDef.extras);
        if (volumeDef.thicknessFactor !== void 0) volume.setThicknessFactor(volumeDef.thicknessFactor);
        if (volumeDef.attenuationDistance !== void 0) volume.setAttenuationDistance(volumeDef.attenuationDistance);
        if (volumeDef.attenuationColor !== void 0) volume.setAttenuationColor(volumeDef.attenuationColor);
        if (volumeDef.thicknessTexture !== void 0) {
          const textureInfoDef = volumeDef.thicknessTexture;
          const texture = context.textures[textureDefs[textureInfoDef.index].source];
          volume.setThicknessTexture(texture);
          context.setTextureInfo(volume.getThicknessTextureInfo(), textureInfoDef);
        }
      }
    });
    return this;
  }
  /** @hidden */
  prewrite(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listMaterials().forEach((material) => {
      const volume = material.getExtension(KHR_MATERIALS_VOLUME);
      if (volume) {
        const materialIndex = context.materialIndexMap.get(material);
        const materialDef = jsonDoc.json.materials[materialIndex];
        const volumeDef = context.createPropertyDef(volume);
        materialDef.extensions = materialDef.extensions || {};
        materialDef.extensions[KHR_MATERIALS_VOLUME] = volumeDef;
        if (volume.getThicknessFactor() > 0) volumeDef.thicknessFactor = volume.getThicknessFactor();
        if (Number.isFinite(volume.getAttenuationDistance())) volumeDef.attenuationDistance = volume.getAttenuationDistance();
        if (!MathUtils.eq(volume.getAttenuationColor(), [
          1,
          1,
          1
        ])) volumeDef.attenuationColor = volume.getAttenuationColor();
        if (volume.getThicknessTexture()) {
          const texture = volume.getThicknessTexture();
          const textureInfo = volume.getThicknessTextureInfo();
          volumeDef.thicknessTexture = context.createTextureInfoDef(texture, textureInfo);
        }
      }
    });
    return this;
  }
};
var KHRMeshPrimitiveRestart = class extends Extension {
  extensionName = KHR_MESH_PRIMITIVE_RESTART;
  static EXTENSION_NAME = KHR_MESH_PRIMITIVE_RESTART;
  /** @hidden */
  read(_) {
    return this;
  }
  /** @hidden */
  write(_) {
    return this;
  }
};
var KHRMeshQuantization = class extends Extension {
  extensionName = KHR_MESH_QUANTIZATION;
  static EXTENSION_NAME = KHR_MESH_QUANTIZATION;
  /** @hidden */
  read(_) {
    return this;
  }
  /** @hidden */
  write(_) {
    return this;
  }
};
var Visibility = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_NODE_VISIBILITY;
  init() {
    this.extensionName = KHR_NODE_VISIBILITY;
    this.propertyType = "Visibility";
    this.parentTypes = [PropertyType.NODE];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), { visible: true });
  }
  /** Visibility of node and descendants. */
  getVisible() {
    return this.get("visible");
  }
  /** Visibility of node and descendants. */
  setVisible(visible) {
    return this.set("visible", visible);
  }
};
var KHRNodeVisibility = class extends Extension {
  static EXTENSION_NAME = KHR_NODE_VISIBILITY;
  extensionName = KHR_NODE_VISIBILITY;
  /** Creates a new Visibility property for use on a {@link Node}. */
  createVisibility() {
    return new Visibility(this.document.getGraph());
  }
  /** @hidden */
  read(context) {
    (context.jsonDoc.json.nodes || []).forEach((nodeDef, nodeIndex) => {
      if (nodeDef.extensions && nodeDef.extensions["KHR_node_visibility"]) {
        const visibility = this.createVisibility();
        context.nodes[nodeIndex].setExtension(KHR_NODE_VISIBILITY, visibility);
        const visibilityDef = nodeDef.extensions[KHR_NODE_VISIBILITY];
        if (visibilityDef.visible !== void 0) visibility.setVisible(visibilityDef.visible);
      }
    });
    return this;
  }
  /** @hidden */
  write(context) {
    const jsonDoc = context.jsonDoc;
    for (const node of this.document.getRoot().listNodes()) {
      const visibility = node.getExtension(KHR_NODE_VISIBILITY);
      if (!visibility) continue;
      const nodeIndex = context.nodeIndexMap.get(node);
      const nodeDef = jsonDoc.json.nodes[nodeIndex];
      nodeDef.extensions = nodeDef.extensions || {};
      nodeDef.extensions[KHR_NODE_VISIBILITY] = { visible: visibility.getVisible() };
    }
    return this;
  }
};
function isUncompressed(container) {
  return container.vkFormat > VK_FORMAT_UNDEFINED && container.vkFormat <= VK_FORMAT_E5B9G9R9_UFLOAT_PACK32;
}
function isUniversal(container) {
  const isBasisHDR = container.vkFormat === VK_FORMAT_ASTC_4x4_SFLOAT_BLOCK_EXT && container.dataFormatDescriptor[0].colorModel === 167;
  return container.vkFormat === VK_FORMAT_UNDEFINED || isBasisHDR;
}
var KTX2ImageUtils = class {
  match(array) {
    return array[0] === 171 && array[1] === 75 && array[2] === 84 && array[3] === 88 && array[4] === 32 && array[5] === 50 && array[6] === 48 && array[7] === 187 && array[8] === 13 && array[9] === 10 && array[10] === 26 && array[11] === 10;
  }
  getSize(array) {
    const container = read(array);
    return [container.pixelWidth, container.pixelHeight];
  }
  getChannels(array) {
    const container = read(array);
    const dfd = container.dataFormatDescriptor[0];
    if (isUncompressed(container)) return dfd.samples.length;
    if (isUniversal(container)) switch (dfd.colorModel) {
      case KHR_DF_MODEL_ETC1S:
        return dfd.samples.length === 2 && (dfd.samples[1].channelType & 15) === 15 ? 4 : 3;
      case KHR_DF_MODEL_UASTC:
        return (dfd.samples[0].channelType & 15) === 3 ? 4 : 3;
      default:
        throw new Error(`Unexpected KTX2 colorModel, "${dfd.colorModel}".`);
    }
    throw new Error(`Unexpected KTX2 vkFormat, "${container.vkFormat}".`);
  }
  getVRAMByteLength(array) {
    const container = read(array);
    let uncompressedBytes = 0;
    if (isUniversal(container)) {
      const hasAlpha = this.getChannels(array) > 3;
      for (let i = 0; i < container.levels.length; i++) {
        const level = container.levels[i];
        if (level.uncompressedByteLength) uncompressedBytes += level.uncompressedByteLength;
        else {
          const levelWidth = Math.max(1, Math.floor(container.pixelWidth / Math.pow(2, i)));
          const levelHeight = Math.max(1, Math.floor(container.pixelHeight / Math.pow(2, i)));
          const blockSize = hasAlpha ? 16 : 8;
          uncompressedBytes += levelWidth / 4 * (levelHeight / 4) * blockSize;
        }
      }
    } else for (const level of container.levels) if (container.supercompressionScheme === KHR_SUPERCOMPRESSION_NONE) uncompressedBytes += level.levelData.byteLength;
    else uncompressedBytes += level.uncompressedByteLength;
    return uncompressedBytes;
  }
};
var KHRTextureBasisu = class extends Extension {
  static EXTENSION_NAME = KHR_TEXTURE_BASISU;
  extensionName = KHR_TEXTURE_BASISU;
  /** @hidden */
  prereadTypes = [PropertyType.TEXTURE];
  /** @hidden */
  static register() {
    ImageUtils.registerFormat("image/ktx2", new KTX2ImageUtils());
  }
  /** @hidden */
  preread(context) {
    if (context.jsonDoc.json.textures) context.jsonDoc.json.textures.forEach((textureDef) => {
      if (textureDef.extensions && textureDef.extensions["KHR_texture_basisu"]) textureDef.source = textureDef.extensions[KHR_TEXTURE_BASISU].source;
    });
    return this;
  }
  /** @hidden */
  read(_context) {
    return this;
  }
  /** @hidden */
  write(context) {
    const jsonDoc = context.jsonDoc;
    this.document.getRoot().listTextures().forEach((texture) => {
      if (texture.getMimeType() === "image/ktx2") {
        const imageIndex = context.imageIndexMap.get(texture);
        jsonDoc.json.textures.forEach((textureDef) => {
          if (textureDef.source === imageIndex) {
            textureDef.extensions = textureDef.extensions || {};
            textureDef.extensions[KHR_TEXTURE_BASISU] = { source: textureDef.source };
            delete textureDef.source;
          }
        });
      }
    });
    return this;
  }
};
var Transform = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_TEXTURE_TRANSFORM;
  init() {
    this.extensionName = KHR_TEXTURE_TRANSFORM;
    this.propertyType = "Transform";
    this.parentTypes = [PropertyType.TEXTURE_INFO];
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      offset: [0, 0],
      rotation: 0,
      scale: [1, 1],
      texCoord: null
    });
  }
  getOffset() {
    return this.get("offset");
  }
  setOffset(offset) {
    return this.set("offset", offset);
  }
  getRotation() {
    return this.get("rotation");
  }
  setRotation(rotation) {
    return this.set("rotation", rotation);
  }
  getScale() {
    return this.get("scale");
  }
  setScale(scale) {
    return this.set("scale", scale);
  }
  getTexCoord() {
    return this.get("texCoord");
  }
  setTexCoord(texCoord) {
    return this.set("texCoord", texCoord);
  }
};
var KHRTextureTransform = class extends Extension {
  extensionName = KHR_TEXTURE_TRANSFORM;
  static EXTENSION_NAME = KHR_TEXTURE_TRANSFORM;
  /** Creates a new Transform property for use on a {@link TextureInfo}. */
  createTransform() {
    return new Transform(this.document.getGraph());
  }
  /** @hidden */
  read(context) {
    for (const [textureInfo, textureInfoDef] of Array.from(context.textureInfos.entries())) {
      if (!textureInfoDef.extensions || !textureInfoDef.extensions["KHR_texture_transform"]) continue;
      const transform = this.createTransform();
      const transformDef = textureInfoDef.extensions[KHR_TEXTURE_TRANSFORM];
      if (transformDef.offset !== void 0) transform.setOffset(transformDef.offset);
      if (transformDef.rotation !== void 0) transform.setRotation(transformDef.rotation);
      if (transformDef.scale !== void 0) transform.setScale(transformDef.scale);
      if (transformDef.texCoord !== void 0) transform.setTexCoord(transformDef.texCoord);
      textureInfo.setExtension(KHR_TEXTURE_TRANSFORM, transform);
    }
    return this;
  }
  /** @hidden */
  write(context) {
    const textureInfoEntries = Array.from(context.textureInfoDefMap.entries());
    for (const [textureInfo, textureInfoDef] of textureInfoEntries) {
      const transform = textureInfo.getExtension(KHR_TEXTURE_TRANSFORM);
      if (!transform) continue;
      textureInfoDef.extensions = textureInfoDef.extensions || {};
      const transformDef = {};
      const eq = MathUtils.eq;
      if (!eq(transform.getOffset(), [0, 0])) transformDef.offset = transform.getOffset();
      if (transform.getRotation() !== 0) transformDef.rotation = transform.getRotation();
      if (!eq(transform.getScale(), [1, 1])) transformDef.scale = transform.getScale();
      if (transform.getTexCoord() != null) transformDef.texCoord = transform.getTexCoord();
      textureInfoDef.extensions[KHR_TEXTURE_TRANSFORM] = transformDef;
    }
    return this;
  }
};
var PARENT_TYPES = [
  PropertyType.ROOT,
  PropertyType.SCENE,
  PropertyType.NODE,
  PropertyType.MESH,
  PropertyType.MATERIAL,
  PropertyType.TEXTURE,
  PropertyType.ANIMATION
];
var Packet = class extends ExtensionProperty {
  static EXTENSION_NAME = KHR_XMP_JSON_LD;
  init() {
    this.extensionName = KHR_XMP_JSON_LD;
    this.propertyType = "Packet";
    this.parentTypes = PARENT_TYPES;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      context: {},
      properties: {}
    });
  }
  /**********************************************************************************************
  * Context.
  */
  /**
  * Returns the XMP context definition URL for the given term.
  * See: https://json-ld.org/spec/latest/json-ld/#the-context
  * @param term Case-sensitive term. Usually a concise, lowercase, alphanumeric identifier.
  */
  getContext() {
    return this.get("context");
  }
  /**
  * Sets the XMP context definition URL for the given term.
  * See: https://json-ld.org/spec/latest/json-ld/#the-context
  *
  * Example:
  *
  * ```typescript
  * packet.setContext({
  *   dc: 'http://purl.org/dc/elements/1.1/',
  *   model3d: 'https://schema.khronos.org/model3d/xsd/1.0/',
  * });
  * ```
  *
  * @param term Case-sensitive term. Usually a concise, lowercase, alphanumeric identifier.
  * @param definition URI for XMP namespace.
  */
  setContext(context) {
    return this.set("context", { ...context });
  }
  /**********************************************************************************************
  * Properties.
  */
  /**
  * Lists properties defined in this packet.
  *
  * Example:
  *
  * ```typescript
  * packet.listProperties(); // → ['dc:Language', 'dc:Creator', 'xmp:CreateDate']
  * ```
  */
  listProperties() {
    return Object.keys(this.get("properties"));
  }
  /**
  * Returns the value of a property, as a literal or JSONLD object.
  *
  * Example:
  *
  * ```typescript
  * packet.getProperty('dc:Creator'); // → {"@list": ["Acme, Inc."]}
  * packet.getProperty('dc:Title'); // → {"@type": "rdf:Alt", "rdf:_1": {"@language": "en-US", "@value": "Lamp"}}
  * packet.getProperty('xmp:CreateDate'); // → "2022-01-01"
  * ```
  */
  getProperty(name) {
    const properties = this.get("properties");
    return name in properties ? properties[name] : null;
  }
  /**
  * Sets the value of a property, as a literal or JSONLD object.
  *
  * Example:
  *
  * ```typescript
  * packet.setProperty('dc:Creator', {'@list': ['Acme, Inc.']});
  * packet.setProperty('dc:Title', {
  * 	'@type': 'rdf:Alt',
  * 	'rdf:_1': {'@language': 'en-US', '@value': 'Lamp'}
  * });
  * packet.setProperty('model3d:preferredSurfaces', {'@list': ['vertical']});
  * ```
  */
  setProperty(name, value) {
    this._assertContext(name);
    const properties = { ...this.get("properties") };
    if (value) properties[name] = value;
    else delete properties[name];
    return this.set("properties", properties);
  }
  /**********************************************************************************************
  * Serialize / Deserialize.
  */
  /**
  * Serializes the packet context and properties to a JSONLD object.
  */
  toJSONLD() {
    return {
      "@context": copyJSON(this.get("context")),
      ...copyJSON(this.get("properties"))
    };
  }
  /**
  * Deserializes a JSONLD packet, then overwrites existing context and properties with
  * the new values.
  */
  fromJSONLD(jsonld) {
    jsonld = copyJSON(jsonld);
    const context = jsonld["@context"];
    if (context) this.set("context", context);
    delete jsonld["@context"];
    return this.set("properties", jsonld);
  }
  /**********************************************************************************************
  * Validation.
  */
  /** @hidden */
  _assertContext(name) {
    if (!(name.split(":")[0] in this.get("context"))) throw new Error(`${KHR_XMP_JSON_LD}: Missing context for term, "${name}".`);
  }
};
function copyJSON(object2) {
  return JSON.parse(JSON.stringify(object2));
}
var KHRXMP = class extends Extension {
  extensionName = KHR_XMP_JSON_LD;
  static EXTENSION_NAME = KHR_XMP_JSON_LD;
  /** Creates a new XMP packet, to be linked with a {@link Document} or {@link Property Properties}. */
  createPacket() {
    return new Packet(this.document.getGraph());
  }
  /** Lists XMP packets currently defined in a {@link Document}. */
  listPackets() {
    return Array.from(this.properties);
  }
  /** @hidden */
  read(context) {
    const extensionDef = context.jsonDoc.json.extensions?.[KHR_XMP_JSON_LD];
    if (!extensionDef || !extensionDef.packets) return this;
    const json = context.jsonDoc.json;
    const root = this.document.getRoot();
    const packets = extensionDef.packets.map((packetDef) => this.createPacket().fromJSONLD(packetDef));
    const defLists = [
      [json.asset],
      json.scenes,
      json.nodes,
      json.meshes,
      json.materials,
      json.images,
      json.animations
    ];
    const propertyLists = [
      [root],
      root.listScenes(),
      root.listNodes(),
      root.listMeshes(),
      root.listMaterials(),
      root.listTextures(),
      root.listAnimations()
    ];
    for (let i = 0; i < defLists.length; i++) {
      const defs = defLists[i] || [];
      for (let j = 0; j < defs.length; j++) {
        const def = defs[j];
        if (def.extensions && def.extensions["KHR_xmp_json_ld"]) {
          const xmpDef = def.extensions[KHR_XMP_JSON_LD];
          propertyLists[i][j].setExtension(KHR_XMP_JSON_LD, packets[xmpDef.packet]);
        }
      }
    }
    return this;
  }
  /** @hidden */
  write(context) {
    const { json } = context.jsonDoc;
    const packetDefs = [];
    for (const packet of this.properties) {
      packetDefs.push(packet.toJSONLD());
      for (const parent of packet.listParents()) {
        let parentDef;
        switch (parent.propertyType) {
          case PropertyType.ROOT:
            parentDef = json.asset;
            break;
          case PropertyType.SCENE:
            parentDef = json.scenes[context.sceneIndexMap.get(parent)];
            break;
          case PropertyType.NODE:
            parentDef = json.nodes[context.nodeIndexMap.get(parent)];
            break;
          case PropertyType.MESH:
            parentDef = json.meshes[context.meshIndexMap.get(parent)];
            break;
          case PropertyType.MATERIAL:
            parentDef = json.materials[context.materialIndexMap.get(parent)];
            break;
          case PropertyType.TEXTURE:
            parentDef = json.images[context.imageIndexMap.get(parent)];
            break;
          case PropertyType.ANIMATION:
            parentDef = json.animations[context.animationIndexMap.get(parent)];
            break;
          default:
            parentDef = null;
            this.document.getLogger().warn(`[${KHR_XMP_JSON_LD}]: Unsupported parent property, "${parent.propertyType}"`);
        }
        if (!parentDef) continue;
        parentDef.extensions = parentDef.extensions || {};
        parentDef.extensions[KHR_XMP_JSON_LD] = { packet: packetDefs.length - 1 };
      }
    }
    if (packetDefs.length > 0) {
      json.extensions = json.extensions || {};
      json.extensions[KHR_XMP_JSON_LD] = { packets: packetDefs };
    }
    return this;
  }
};
var KHRONOS_EXTENSIONS = [
  KHRAccessorFloat16,
  KHRAccessorFloat64,
  KHRDracoMeshCompression,
  KHRLightsPunctual,
  KHRMaterialsAnisotropy,
  KHRMaterialsClearcoat,
  KHRMaterialsDiffuseTransmission,
  KHRMaterialsDispersion,
  KHRMaterialsEmissiveStrength,
  KHRMaterialsIOR,
  KHRMaterialsIridescence,
  KHRMaterialsPBRSpecularGlossiness,
  KHRMaterialsSpecular,
  KHRMaterialsSheen,
  KHRMaterialsTransmission,
  KHRMaterialsUnlit,
  KHRMaterialsVariants,
  KHRMaterialsVolume,
  KHRMeshPrimitiveRestart,
  KHRMeshQuantization,
  KHRNodeVisibility,
  KHRTextureBasisu,
  KHRTextureTransform,
  KHRXMP
];
var ALL_EXTENSIONS = [
  EXTMeshGPUInstancing,
  EXTMeshFeatures,
  EXTMeshoptCompression,
  EXTStructuralMetadata,
  EXTTextureAVIF,
  EXTTextureWebP,
  ...KHRONOS_EXTENSIONS
];

// vendor/daemon/merge-animations.ts
async function mergeAnimationClips(files) {
  const [first, ...rest] = files;
  if (!first) throw new Model3DGenerationError("No animated models to merge");
  if (rest.length === 0) return first;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const target = await io.readBinary(first);
  const root = target.getRoot();
  const buffer = root.listBuffers()[0] ?? target.createBuffer();
  const bones = new Map(root.listNodes().map((node) => [node.getName(), node]));
  const clipNames = new Set(root.listAnimations().map((animation) => animation.getName()));
  for (const file of rest) {
    for (const source of (await io.readBinary(file)).getRoot().listAnimations()) {
      copyAnimation(target, source, buffer, bones, uniqueName(source.getName(), clipNames));
    }
  }
  return Buffer.from(await io.writeBinary(target));
}
function copyAnimation(target, source, buffer, bones, name) {
  const copies = /* @__PURE__ */ new Map();
  const copy = (accessor) => {
    if (!accessor) throw new Model3DGenerationError("Meshy returned an animation without keyframes");
    let copied = copies.get(accessor);
    if (!copied) {
      copied = target.createAccessor().setType(accessor.getType()).setArray(accessor.getArray().slice()).setNormalized(accessor.getNormalized()).setBuffer(buffer);
      copies.set(accessor, copied);
    }
    return copied;
  };
  const animation = target.createAnimation(name);
  for (const channel of source.listChannels()) {
    const sourceSampler = channel.getSampler();
    const bone = bones.get(channel.getTargetNode()?.getName() ?? "");
    const path2 = channel.getTargetPath();
    if (!sourceSampler || !bone || !path2) throw new Model3DGenerationError("Meshy returned animations for different skeletons");
    const sampler = target.createAnimationSampler().setInterpolation(sourceSampler.getInterpolation()).setInput(copy(sourceSampler.getInput())).setOutput(copy(sourceSampler.getOutput()));
    animation.addSampler(sampler).addChannel(target.createAnimationChannel().setTargetNode(bone).setTargetPath(path2).setSampler(sampler));
  }
}
function uniqueName(name, taken) {
  let candidate = name;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${name}_${suffix}`;
  taken.add(candidate);
  return candidate;
}

// vendor/shared/model3d-operations.ts
var MODEL3D_OPERATIONS = ["image", "text", "retexture", "remesh", "animate"];
function protocolOperations(protocol) {
  return protocol === "hyper3d" ? ["image", "text", "retexture"] : [...MODEL3D_OPERATIONS];
}
function remeshPolycount(protocol) {
  if (protocol === "tripo") return { min: 500, max: 2e4, default: 4e3, presets: [1e3, 4e3, 1e4, 2e4] };
  return { min: 100, max: protocol === "meshy" ? 3e5 : 15e5, default: 3e4, presets: [1e3, 4e3, 1e4, 3e4, 1e5, 3e5] };
}
var TRIPO_ANIMATIONS_V1 = ["afraid", "agree", "angry_01", "angry_02", "angry_03", "basketball_shot", "bow", "box_01", "box_02", "box_03", "cast_a_spell", "cheer", "chop", "clap", "climb", "complain_01", "complain_02", "cross_body_crunch", "crossover_dribble", "cry", "dance_01", "dance_02", "dance_03", "dance_04", "dance_05", "dance_06", "defeat_02", "defeat_03", "depressed", "dig", "dive", "dribble", "fall", "fire", "flee_01", "flee_02", "flip", "fold_arms", "football_catch", "football_save", "football_pass", "freaky", "frightened", "front_kick_01", "front_kick_02", "frustrated_01", "frustrated_02", "golf", "greet_01", "greet_02", "greet_03", "greet_04", "heart_pose", "hit_to_body_01", "hit_to_body_02", "hit_to_head", "hit_to_side", "hit_to_stomach", "hug", "hurt", "idle", "jump_down", "jump", "jump_rope_01", "jump_rope_02", "laugh_01", "laugh_02", "lift_heavy", "look_around", "make_a_call_01", "make_a_call_02", "pitch_baseball", "play_mobile_game", "play_video_game", "press-up", "run_upstairs", "run", "scared_01", "scared_02", "scratch", "shoot", "shovel", "sing_01", "sing_02", "sing_03", "sing_04", "sit", "slash", "sob", "standing_relax", "surf", "swagger", "swim", "turn", "victory_celebration", "volleyball", "wait", "walk", "warm_up", "wave_goodbye_01", "wave_goodbye_02"];
function tripoActions(version = "v1.0-20240301", rigType = "biped") {
  const names = version === "v1.0-20240301" ? TRIPO_ANIMATIONS_V1 : rigType === "biped" ? ["idle", "walk", "run", "dive", "climb", "jump", "slash", "shoot", "hurt", "fall", "turn"] : [rigType === "serpentine" || rigType === "aquatic" ? "march" : "walk"];
  const prefix = version === "v1.0-20240301" ? "biped:" : rigType === "biped" ? "" : `${rigType}:`;
  return names.map((name) => ({ id: `preset:${prefix}${name}`, name: name.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), category: rigType, subCategory: version }));
}

// vendor/shared/cloud-models.ts
var HYPER3D_CONNECTION_ID = "cloud-hyper3d";
var HYPER3D_DEFAULT_TIER = "Gen-2.5-Medium";
var HYPER3D_MODELS = [HYPER3D_DEFAULT_TIER, "Gen-2.5-Low", "Gen-2.5-High", "Gen-2.5-Extreme-Low", "Gen-2.5-Extreme-High", "Gen-2", "Sketch", "Regular", "Detail", "Smooth"].map((tier) => {
  const generationLabel = tier.startsWith("Gen-") ? tier.replace("Gen-", "Gen ").replaceAll("-", " ") : `Gen 1/1.5 ${tier}`;
  const max = !tier.startsWith("Gen-") ? 2e5 : ["Gen-2.5-High", "Gen-2.5-Extreme-High"].includes(tier) ? 2e6 : 1e6;
  return {
    provider: HYPER3D_CONNECTION_ID,
    id: tier,
    name: `Rodin ${generationLabel}`,
    capability: "3d",
    generationLabel,
    estimatedCredits: tier === "Gen-2.5-Extreme-High" ? 1 : 0.5,
    maxReferenceImages: 5,
    polycount: { min: 500, max, default: 4e3, presets: [1e3, 4e3, 1e4, 2e4, 1e5] },
    supportsTexture: true,
    supportsPbr: true
  };
});
var BUILTIN_CLOUD_CATALOG = {
  providers: [{ id: HYPER3D_CONNECTION_ID, upstreamProvider: "hyper3d", name: "Hyper3D", capabilities: ["3d"] }],
  models: HYPER3D_MODELS
};
function hyper3DCredits(tier) {
  return HYPER3D_MODELS.find((model) => model.id === tier)?.estimatedCredits;
}

// vendor/shared/contracts.ts
var IMAGE_MAX_REFERENCE_IMAGES = 16;
var IMAGE_RESOLUTIONS = ["512", "1K", "2K", "4K"];
var IMAGE_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
var IMAGE_OUTPUT_COUNTS = [1, 2, 3, 4];
var VIDEO_ASPECT_RATIOS = ["adaptive", "21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "9:21"];
var VIDEO_RESOLUTIONS = ["480p", "720p", "768p", "1080p", "1K", "2K", "4K"];

// vendor/shared/custom-models.ts
var IMAGE_PROTOCOL_LABELS = {
  "openai-images": "OpenAI Images",
  "gemini-generate-content": "Gemini Generate Content",
  "openrouter-images": "OpenRouter Images",
  "volcengine-images": "Seedream"
};
var VIDEO_PROTOCOL_LABELS = { "openrouter-videos": "OpenRouter Videos", seedance: "Seedance" };
function defaultModel3DSettings(modelType = "standard", protocol = "meshy") {
  if (protocol === "hyper3d") return {
    protocol,
    operation: "multi-image-to-3d",
    modelType: "standard",
    maxReferenceImages: 5,
    polycount: { min: 500, max: 1e6, default: 4e3, presets: [1e3, 4e3, 1e4, 2e4, 1e5] },
    supportsTexture: true,
    supportsPbr: true
  };
  if (protocol === "tripo") return {
    protocol,
    operation: "multi-image-to-3d",
    modelType: "standard",
    maxReferenceImages: 4,
    polycount: { min: 50, max: 2e4, default: 4e3, presets: [1e3, 4e3, 1e4, 2e4] },
    supportsTexture: true,
    supportsPbr: true
  };
  if (modelType === "smart-topology") return {
    protocol: "meshy",
    operation: "image-to-3d",
    modelType,
    maxReferenceImages: 1,
    polycount: { min: 100, max: 15e3, default: 4e3, presets: [1e3, 4e3, 1e4, 15e3] },
    supportsTexture: true,
    supportsPbr: true
  };
  return {
    protocol: "meshy",
    operation: "image-to-3d",
    modelType: "standard",
    maxReferenceImages: 1,
    polycount: { min: 100, max: 3e5, default: 3e4, presets: [1e4, 3e4, 1e5] },
    supportsTexture: true,
    supportsPbr: true
  };
}
function model3DModel(provider, providerName, model) {
  const config = model.settings;
  return {
    provider,
    providerName,
    id: model.id,
    name: model.name,
    protocol: config.protocol,
    operations: protocolOperations(config.protocol),
    ...config.protocol === "tripo" ? { referenceImageLabels: ["Front", "Left", "Back", "Right"] } : {},
    ...config.protocol === "hyper3d" ? { estimatedCredits: hyper3DCredits(model.id) } : {},
    maxReferenceImages: config.maxReferenceImages,
    polycount: config.polycount,
    supportsTexture: config.supportsTexture,
    supportsPbr: config.supportsPbr,
    defaults: config.defaults ?? { texture: config.supportsTexture, pbr: false }
  };
}
function normalizeModelUsages(value) {
  if (value === void 0) return void 0;
  if (!object(value) || Object.keys(value).some((key) => !["language", "image", "video", "3d"].includes(key))) throw new Error("Invalid model uses");
  const usages = {};
  if (value.language !== void 0) {
    if (typeof value.language !== "boolean") throw new Error("Invalid language capability");
    if (value.language) usages.language = true;
  }
  if (value.image !== void 0) {
    const config = value.image;
    if (!object(config) || !Object.hasOwn(IMAGE_PROTOCOL_LABELS, String(config.protocol))) throw new Error("Choose an image protocol");
    usages.image = {
      protocol: config.protocol,
      ...endpoint(config),
      resolutions: choices(config.resolutions, IMAGE_RESOLUTIONS.filter((value2) => value2 !== "512" || config.protocol === "gemini-generate-content" || config.protocol === "openrouter-images"), "image resolutions"),
      aspectRatios: choices(config.aspectRatios, IMAGE_ASPECT_RATIOS, "image aspect ratios"),
      maxReferenceImages: integer(config.maxReferenceImages, 0, IMAGE_MAX_REFERENCE_IMAGES, "reference image limit"),
      maxOutputs: choices([config.maxOutputs], IMAGE_OUTPUT_COUNTS, "image output count")[0]
    };
  }
  if (value.video !== void 0) {
    const config = value.video;
    if (!object(config) || !Object.hasOwn(VIDEO_PROTOCOL_LABELS, String(config.protocol))) throw new Error("Choose a video protocol");
    if (!Array.isArray(config.durations) || !config.durations.length || config.durations.length > 30) throw new Error("Choose video durations");
    const maxReferenceImages = integer(config.maxReferenceImages, 0, 30, "reference image limit");
    const referenceModes = choices(config.referenceModes, ["frame", "reference"], "video reference modes");
    if (referenceModes.includes("frame") && maxReferenceImages > 2 && !referenceModes.includes("reference")) throw new Error("Frame mode accepts at most two reference images");
    usages.video = {
      protocol: config.protocol,
      ...endpoint(config),
      resolutions: choices(config.resolutions, VIDEO_RESOLUTIONS, "video resolutions"),
      aspectRatios: choices(config.aspectRatios, VIDEO_ASPECT_RATIOS, "video aspect ratios"),
      durations: [...new Set(config.durations.map((duration) => integer(duration, 1, 30, "video duration")))].sort((a, b) => a - b),
      maxReferenceImages,
      referenceModes
    };
  }
  if (value["3d"] !== void 0) {
    const config = value["3d"];
    if (!object(config) || !["meshy", "tripo", "hyper3d"].includes(String(config.protocol)) || !["image-to-3d", "multi-image-to-3d"].includes(String(config.operation)) || !["standard", "smart-topology"].includes(String(config.modelType))) throw new Error("Choose a 3D generation protocol and template");
    if (config.protocol !== "meshy" && config.modelType !== "standard") throw new Error("Smart topology is only supported by Meshy");
    if (config.modelType === "smart-topology" && config.operation !== "image-to-3d") throw new Error("Smart topology requires a single image");
    const maxReferenceImages = integer(config.maxReferenceImages, 1, config.operation === "image-to-3d" ? 1 : config.protocol === "hyper3d" ? 5 : 4, "3D reference image limit");
    if (!object(config.polycount)) throw new Error("Set the 3D polycount range");
    const limit = config.protocol === "hyper3d" ? 2e6 : config.protocol === "tripo" ? 15e5 : 3e5;
    const min = integer(config.polycount.min, config.protocol === "hyper3d" ? 500 : config.protocol === "tripo" ? 48 : 100, limit, "minimum polycount");
    const max = integer(config.polycount.max, min, limit, "maximum polycount");
    const defaultCount = integer(config.polycount.default, min, max, "default polycount");
    if (!Array.isArray(config.polycount.presets) || !config.polycount.presets.length || config.polycount.presets.length > 20) throw new Error("Set polycount presets");
    const presets = [...new Set(config.polycount.presets.map((count) => integer(count, min, max, "polycount preset")))].sort((a, b) => a - b);
    if (typeof config.supportsTexture !== "boolean" || typeof config.supportsPbr !== "boolean" || config.supportsPbr && !config.supportsTexture) throw new Error("PBR requires texture support");
    let defaults;
    if (config.defaults !== void 0) {
      if (!object(config.defaults) || typeof config.defaults.texture !== "boolean" || typeof config.defaults.pbr !== "boolean" || config.defaults.texture && !config.supportsTexture || config.defaults.pbr && (!config.defaults.texture || !config.supportsPbr)) throw new Error("Generation defaults must use supported texture and PBR options");
      defaults = { texture: config.defaults.texture, pbr: config.defaults.pbr };
    }
    const operations = config.operations === void 0 ? void 0 : Array.isArray(config.operations) && !config.operations.length ? [] : choices(config.operations, protocolOperations(config.protocol), "3D operations");
    usages["3d"] = {
      ...operations ? { operations } : {},
      protocol: config.protocol,
      ...endpoint(config),
      operation: config.operation,
      modelType: config.modelType,
      maxReferenceImages,
      polycount: { min, max, default: defaultCount, presets },
      supportsTexture: config.supportsTexture,
      supportsPbr: config.supportsPbr,
      ...defaults ? { defaults } : {}
    };
  }
  return usages;
}
function normalizeEndpoint(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Base URL is required");
  const url = new URL(value.trim());
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Base URL must be an HTTP(S) URL without credentials, query or fragment");
  return value.trim().replace(/\/+$/, "");
}
function endpoint(config) {
  return config.baseUrl === void 0 || config.baseUrl === "" ? {} : { baseUrl: normalizeEndpoint(config.baseUrl) };
}
function object(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function integer(value, min, max, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Check ${label} (${min}\u2013${max})`);
  return value;
}
function choices(value, allowed, label) {
  if (!Array.isArray(value) || !value.length || value.length > allowed.length || value.some((item) => !allowed.includes(item))) throw new Error(`Choose supported ${label}`);
  return [...new Set(value)];
}

// vendor/shared/model3d-presets.ts
var NATIVE_3D_PROVIDER_NAMES = { meshy: "Meshy", tripo: "Tripo", hyper3d: "Hyper3D" };
function isNative3DProvider(id) {
  return Object.hasOwn(NATIVE_3D_PROVIDER_NAMES, id);
}
var MODEL_3D_PRESETS = {
  meshy: [
    { id: "meshy-t2", name: "Meshy T2", settings: defaultModel3DSettings("smart-topology") },
    { id: "meshy-t2.5", name: "Meshy T2.5", settings: {
      ...defaultModel3DSettings("smart-topology"),
      polycount: { min: 100, max: 3e4, default: 15e3, presets: [1e3, 4e3, 1e4, 15e3, 3e4] }
    } },
    { id: "meshy-7.1", name: "Meshy 7.1", settings: { ...defaultModel3DSettings(), operation: "multi-image-to-3d", maxReferenceImages: 4 } },
    ...["meshy-7", "meshy-6", "meshy-6-lite", "latest"].map((id) => ({
      id,
      name: id === "latest" ? "Meshy Latest" : id === "meshy-7" ? "Meshy 7 (deprecated)" : id.replace("meshy-", "Meshy ").replace("-lite", " Lite"),
      settings: { ...defaultModel3DSettings(), operation: "multi-image-to-3d", maxReferenceImages: 4 }
    }))
  ],
  tripo: [
    { id: "P1-20260311", name: "Tripo P1", settings: defaultModel3DSettings("standard", "tripo") },
    { id: "v3.1-20260211", name: "Tripo V3.1", settings: {
      ...defaultModel3DSettings("standard", "tripo"),
      polycount: { min: 100, max: 15e5, default: 3e4, presets: [1e4, 3e4, 1e5, 3e5] }
    } },
    { id: "P2-20260801", name: "Tripo P2 (preview)", settings: {
      ...defaultModel3DSettings("standard", "tripo"),
      polycount: { min: 48, max: 5e4, default: 4e3, presets: [1e3, 4e3, 1e4, 2e4, 5e4] }
    } },
    ...[{ id: "v3.0-20250812", name: "Tripo V3.0", max: 1e6 }, { id: "v2.5-20250123", name: "Tripo V2.5", max: 5e5 }].map(({ id, name, max }) => ({
      id,
      name,
      settings: { ...defaultModel3DSettings("standard", "tripo"), polycount: { min: 100, max, default: 3e4, presets: [1e4, 3e4, 1e5, 3e5] } }
    }))
  ],
  hyper3d: HYPER3D_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    settings: { ...defaultModel3DSettings("standard", "hyper3d"), polycount: model.polycount }
  }))
};
function model3DPreset(provider, id) {
  return isNative3DProvider(provider) ? MODEL_3D_PRESETS[provider].find((model) => model.id === id) : void 0;
}
function normalizeNativeModel3D(provider, value, mode = "edit") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid 3D model");
  const input = value;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() || id : id;
  if (!id || id.length > 200 || /[\s\x00-\x1f]/.test(id) || name.length > 200 || /[\x00-\x1f]/.test(name)) throw new Error("Enter a model ID and name (up to 200 characters)");
  const settings = normalizeModelUsages({ "3d": input.settings })?.["3d"];
  if (!settings || settings.protocol !== provider || settings.baseUrl) throw new Error("Use this provider's 3D protocol and connection");
  const preset = model3DPreset(provider, id);
  if (preset && mode === "restore") {
    const polycount = preset.settings.polycount;
    const presets = settings.polycount.presets.filter((count) => count >= polycount.min && count <= polycount.max);
    return { id, name, settings: {
      ...preset.settings,
      defaults: settings.defaults,
      polycount: {
        ...polycount,
        default: Math.max(polycount.min, Math.min(polycount.max, settings.polycount.default)),
        presets: presets.length ? presets : polycount.presets
      }
    } };
  }
  if (preset) {
    for (const key of ["protocol", "operation", "modelType", "maxReferenceImages", "supportsTexture", "supportsPbr"]) {
      if (settings[key] !== preset.settings[key]) throw new Error("Official model capabilities cannot be changed. Add a custom version instead.");
    }
    if (settings.polycount.min !== preset.settings.polycount.min || settings.polycount.max !== preset.settings.polycount.max) throw new Error("Keep the official model's face-count range");
  }
  return { id, name, settings };
}

// vendor/shared/generation-config.ts
var MODEL_3D_MODELS = [
  ...Object.entries(MODEL_3D_PRESETS).flatMap(([provider, models]) => models.map((model) => model3DModel(provider, NATIVE_3D_PROVIDER_NAMES[provider], model))),
  ...BUILTIN_CLOUD_CATALOG.models.filter((model) => model.capability === "3d").map((model) => ({ ...model, providerName: "Hyper3D", maxReferenceImages: model.maxReferenceImages, polycount: model.polycount }))
];
var DEFAULT_MODEL_3D = MODEL_3D_MODELS.find((model) => model.provider === "meshy");
var MODEL_3D_MAX_REFERENCE_IMAGES = Math.max(...MODEL_3D_MODELS.map((model) => model.maxReferenceImages));
var MODEL_3D_MAX_POLYCOUNT = Math.max(...MODEL_3D_MODELS.map((model) => model.polycount.max));
var ANIMATION_ACTIONS_PER_REQUEST = 10;
var MAX_ANIMATION_ACTIONS = 30;
var DEFAULT_MODEL_3D_CONFIG = {
  targetPolycount: DEFAULT_MODEL_3D.polycount.default,
  texture: true,
  pbr: false
};

// vendor/daemon/model3d-inspect.ts
async function inspectModel3D(bytes) {
  try {
    const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
    const root = document.getRoot();
    let triangles = 0;
    for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
      const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
      const mode = primitive.getMode();
      if (mode === 4) triangles += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
    }
    if (!triangles) throw new Error("Model has no triangle geometry");
    return { triangles, textured: root.listTextures().length > 0, rigged: root.listSkins().length > 0, animations: root.listAnimations().map((clip) => clip.getName()) };
  } catch (cause) {
    throw new Model3DGenerationError(`Invalid GLB model: ${cause instanceof Error ? cause.message : String(cause)}`, 400);
  }
}
async function modelFacingPositiveZ(bytes, axis) {
  if (axis !== "+X") return bytes;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), document = await io.readBinary(bytes);
  const scenes = document.getRoot().listScenes().map((scene) => ({ scene, children: scene.listChildren() }));
  const parents = /* @__PURE__ */ new Map();
  for (const { scene, children } of scenes) {
    for (const child of children) {
      let parent = parents.get(child);
      if (!parent) {
        parent = document.createNode("Forward axis +Z").setRotation([0, -Math.SQRT1_2, 0, Math.SQRT1_2]).addChild(child);
        parents.set(child, parent);
      }
      scene.addChild(parent);
    }
  }
  return Buffer.from(await io.writeBinary(document));
}

// vendor/daemon/meshy-provider.ts
var BASE_URL = "https://api.meshy.ai/openapi/v1";
var POLL_INTERVAL_MS = 2e3;
var MAX_WAIT_MS = 60 * 6e4;
var MAX_POLL_NETWORK_FAILURES = 3;
var MeshyProvider = class {
  constructor(apiKey, request = fetch, pollIntervalMs = POLL_INTERVAL_MS, isEnabled = () => true, connection) {
    this.apiKey = apiKey;
    this.request = request;
    this.pollIntervalMs = pollIntervalMs;
    this.isEnabled = isEnabled;
    this.connection = connection;
  }
  /** Reuse paid rigs across jobs; each job journals the rig it uses for recovery. */
  #rigs = /* @__PURE__ */ new Map();
  async generate(input, signal, settings) {
    const config = settings ?? this.connection?.settings ?? model3DPreset(input.model.provider, input.model.id)?.settings;
    const meshy = meshyTask(input, config);
    return this.#session(signal, "Meshy generation timed out", async (apiKey, requestSignal) => {
      let { taskId, task } = await this.#runTask(apiKey, meshy.endpoint, meshy.body, requestSignal, "Meshy generation request failed", input.execution, "generate");
      if (input.operation === "text" && (input.texture ?? config?.defaults?.texture ?? config?.supportsTexture ?? true)) {
        ({ taskId, task } = await this.#runTask(apiKey, "text-to-3d", { mode: "refine", preview_task_id: taskId, enable_pbr: input.pbr ?? config?.defaults?.pbr ?? false }, requestSignal, "Meshy texture refinement failed", input.execution, "refine"));
      }
      return { bytes: await this.#downloadGlb(record(task.model_urls).glb, requestSignal), mediaType: "model/gltf-binary", requestId: taskId, ...!input.operation || input.operation === "image" || input.operation === "text" ? { metadata: { forwardAxis: "+Z" } } : {} };
    });
  }
  /**
   * Rigs a humanoid GLB, then bakes the chosen library actions into one file with a clip per action. Meshy caps each
   * animation request, so larger sets run as sequential requests on the same rig and their clips are merged.
   */
  async animate(input, signal) {
    if (input.actionIds.some((id) => typeof id !== "number" || !Number.isInteger(id) || id < 0)) throw new Model3DGenerationError("Meshy actions must be numeric library IDs", 400);
    if (input.actionIds.length < 1 || input.actionIds.length > MAX_ANIMATION_ACTIONS) {
      throw new Model3DGenerationError(`Choose 1 to ${MAX_ANIMATION_ACTIONS} animations`, 400);
    }
    return this.#session(signal, "Meshy animation timed out", async (apiKey, requestSignal) => {
      const rigTaskId = await this.#rig(apiKey, input, requestSignal);
      const batches = [];
      for (const [index, actionIds] of chunks(input.actionIds, ANIMATION_ACTIONS_PER_REQUEST).entries()) {
        const { taskId, task } = await this.#runTask(apiKey, "animations", {
          rig_task_id: rigTaskId,
          action_ids: actionIds
        }, requestSignal, "Meshy animation request failed", input.execution, `animation-${index}`);
        batches.push({ taskId, bytes: await this.#downloadGlb(record(task.result).animation_glb_url, requestSignal) });
      }
      const bytes = await mergeAnimationClips(batches.map((batch) => batch.bytes));
      return { bytes, mediaType: "model/gltf-binary", requestId: batches.map((batch) => batch.taskId).join(","), metadata: { forwardAxis: "+Z" } };
    });
  }
  /** Reuses a recent rig of the same model and height, since re-animating a character is common and rigging is billed. */
  async #rig(apiKey, input, signal) {
    const key = (0, import_node_crypto.createHash)("sha256").update(this.scope(apiKey)).update(input.model).update(`\0${input.heightMeters ?? ""}\0${input.forwardAxis ?? ""}`).digest("hex");
    const body = {
      model_url: `data:application/octet-stream;base64,${(await modelFacingPositiveZ(input.model, input.forwardAxis)).toString("base64")}`,
      height_meters: input.heightMeters
    };
    const url = `${this.baseUrl}/rigging`;
    let reused = false;
    const submit = async () => {
      const cached = this.#rigs.get(key);
      if (cached && await this.#rigAvailable(apiKey, cached, signal)) {
        reused = true;
        return { taskId: cached };
      }
      this.#rigs.delete(key);
      return this.#submitTask(apiKey, url, body, signal, "Meshy rigging request failed");
    };
    const { taskId } = input.execution ? await input.execution.submitted("rig", this.scope(apiKey), { endpoint: "rigging", body }, submit) : await submit();
    if (!reused) await this.#waitTask(apiKey, url, taskId, signal);
    this.#rigs.set(key, taskId);
    return taskId;
  }
  /**
   * Status checks are free, so a cached rig is confirmed before animation requests are spent on it. Meshy answers an
   * unknown task ID with some other task of the account rather than a 404, hence the ID check. Any failure just rigs again.
   */
  async #rigAvailable(apiKey, taskId, signal) {
    try {
      const task = await this.json(`${this.baseUrl}/rigging/${encodeURIComponent(taskId)}`, { signal }, apiKey, "Meshy status request failed");
      const expiresAt = task.expires_at;
      return task.id === taskId && string(task.status)?.toUpperCase() === "SUCCEEDED" && typeof expiresAt === "number" && expiresAt > Date.now() + MAX_WAIT_MS;
    } catch {
      signal.throwIfAborted();
      return false;
    }
  }
  /** Lists Meshy's preset animations; the call is free, so the daemon can show them before anything is spent. */
  async animations(signal, _model, _options) {
    return this.#session(signal, "Meshy animation library timed out", async (apiKey, requestSignal) => {
      const body = await this.json(`${this.baseUrl}/animations/library`, { signal: requestSignal }, apiKey, "Meshy animation library request failed");
      const items = Array.isArray(body) ? body : [];
      return items.flatMap((item) => {
        const value = record(item);
        const id = value.action_id;
        const name = string(value.name);
        if (typeof id !== "number" || !Number.isInteger(id) || !name) return [];
        return [{
          id,
          name,
          category: string(value.category) ?? "Other",
          subCategory: string(value.sub_category) ?? "Other",
          ...httpUrl(value.preview_url) ? { previewUrl: value.preview_url } : {}
        }];
      });
    });
  }
  async #session(signal, timeoutMessage, run) {
    if (!this.isEnabled()) throw new Model3DGenerationError("Meshy provider is disabled", 409);
    const apiKey = this.apiKey();
    if (!apiKey && this.connection?.authentication !== "none") throw new Model3DGenerationError("Meshy API key is not configured", 503);
    const timeout = AbortSignal.timeout(MAX_WAIT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await run(apiKey ?? "", requestSignal);
    } catch (cause) {
      if (timeout.aborted && !signal?.aborted) throw new Model3DGenerationError(timeoutMessage, 504);
      throw cause;
    }
  }
  /** Creates a task and polls it until it finishes; Meshy's task endpoints all share this shape. */
  async #runTask(apiKey, endpoint2, body, signal, message, execution, stage = endpoint2) {
    const base = endpoint2 === "text-to-3d" ? this.baseUrl.replace(/\/v1$/, "/v2") : this.baseUrl;
    const url = `${base}/${endpoint2}`;
    const submit = () => this.#submitTask(apiKey, url, body, signal, message);
    const { taskId } = execution ? await execution.submitted(stage, this.scope(apiKey), { endpoint: endpoint2, body }, submit) : await submit();
    return { taskId, task: await this.#waitTask(apiKey, url, taskId, signal) };
  }
  async #submitTask(apiKey, url, body, signal, message) {
    const created = await this.json(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal
    }, apiKey, message);
    const taskId = string(created.result) ?? string(created.id);
    if (!taskId) throw new Model3DGenerationError("Meshy returned no task ID");
    return { taskId };
  }
  async #waitTask(apiKey, url, taskId, signal) {
    let networkFailures = 0;
    while (true) {
      signal.throwIfAborted();
      let task;
      try {
        task = await this.json(`${url}/${encodeURIComponent(taskId)}`, { signal }, apiKey, "Meshy status request failed");
        networkFailures = 0;
      } catch (cause) {
        if (!(cause instanceof MeshyNetworkError) || ++networkFailures >= MAX_POLL_NETWORK_FAILURES) throw cause;
        await delay(this.pollIntervalMs, signal);
        continue;
      }
      const status = string(task.status)?.toUpperCase();
      if (status === "SUCCEEDED" || status === "COMPLETED") return task;
      if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED") {
        throw new Model3DGenerationError(string(record(task.task_error).message) ?? string(task.message) ?? `Meshy task ${status.toLowerCase()}`, 400);
      }
      await delay(this.pollIntervalMs, signal);
    }
  }
  async #downloadGlb(url, signal) {
    if (!httpUrl(url)) throw new Model3DGenerationError("Meshy task completed without a GLB artifact");
    const content = await this.request(url, { signal });
    if (!content.ok) throw new Model3DGenerationError(`Meshy GLB download failed (${content.status})`, content.status);
    return readModel3DResult(content);
  }
  async json(url, init, apiKey, message) {
    let response;
    try {
      response = await this.request(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(6e4), ...init.signal ? [init.signal] : []]), headers: { ...this.connection?.headers, ...this.connection?.authentication === "none" ? {} : { authorization: `Bearer ${apiKey}` }, ...init.headers } });
    } catch (cause) {
      if (init.signal?.aborted) throw init.signal.reason ?? cause;
      throw new MeshyNetworkError(cause);
    }
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;
    if (response.status === 401 || response.status === 403) throw new Model3DGenerationError("Meshy API key was rejected", 503);
    if (response.status === 429) throw new Model3DGenerationError("Meshy is temporarily rate limited", 429);
    throw new Model3DGenerationError(`Meshy ${response.status}: ${string(body.message) ?? message}`, response.status >= 500 ? 502 : 400);
  }
  scope(key) {
    return JSON.stringify([this.baseUrl, key, this.connection?.headers, this.connection?.authentication]);
  }
  async accountBalance(signal) {
    return this.#session(signal, "Meshy balance timed out", async (key, requestSignal) => {
      const value = await this.json(`${this.baseUrl}/balance`, { signal: requestSignal }, key, "Balance request failed");
      if (typeof value.balance !== "number") throw new Model3DGenerationError("Meshy returned an invalid balance");
      return { balance: value.balance };
    });
  }
  get baseUrl() {
    return (this.connection?.baseUrl ?? BASE_URL).replace(/\/$/, "");
  }
};
var MeshyNetworkError = class extends Model3DGenerationError {
  constructor(cause) {
    super(`Could not reach Meshy (${networkErrorDetail(cause)})`, 502);
  }
};
function networkErrorDetail(cause) {
  const inner = cause instanceof Error && cause.cause instanceof Error ? cause.cause : cause;
  if (!(inner instanceof Error)) return String(inner);
  const code = inner.code;
  return typeof code === "string" && !inner.message.includes(code) ? `${code}: ${inner.message}` : inner.message;
}
function meshyTask(input, settings) {
  if (!settings || settings.protocol !== "meshy") throw new Model3DGenerationError(`Meshy does not offer ${input.model.provider}/${input.model.id}`, 400);
  const operation = input.operation ?? "image";
  if (operation === "retexture" || operation === "remesh") {
    if (!input.source?.length) throw new Model3DGenerationError("Choose a source GLB", 400);
    const model_url = `data:application/octet-stream;base64,${input.source.toString("base64")}`;
    if (operation === "remesh") {
      const range = remeshPolycount("meshy"), count = input.targetPolycount ?? range.default;
      if (!Number.isInteger(count) || count < range.min || count > range.max) throw new Model3DGenerationError("Meshy remesh face count must be 100\u2013300000", 400);
      return { endpoint: "remesh", body: { model_url, target_polycount: count, topology: "triangle", target_formats: ["glb"] } };
    }
    if (input.images.length > 1 || input.images.length && input.prompt?.trim()) throw new Model3DGenerationError("Meshy retexture accepts one style image or a prompt", 400);
    const ai_model = input.options?.textureModel ?? "latest";
    if (!["latest", "meshy-7", "meshy-6", "meshy-6-lite"].includes(ai_model)) throw new Model3DGenerationError("Unsupported Meshy texture version", 400);
    return { endpoint: "retexture", body: {
      model_url,
      ai_model,
      enable_pbr: input.pbr ?? false,
      ...input.images[0] ? { image_style_url: `data:${input.images[0].mediaType};base64,${input.images[0].data}` } : { text_style_prompt: input.prompt }
    } };
  }
  const images = input.images.map((image) => `data:${image.mediaType};base64,${image.data}`);
  if (operation === "image" && (images.length < 1 || images.length > settings.maxReferenceImages)) {
    const name = model3DPreset(input.model.provider, input.model.id)?.name ?? input.model.id;
    throw new Model3DGenerationError(settings.maxReferenceImages === 1 ? `${name} requires exactly one reference image` : `${name} takes 1 to ${settings.maxReferenceImages} reference images`, 400);
  }
  const polycount = input.targetPolycount ?? settings.polycount.default;
  if (!Number.isInteger(polycount) || polycount < settings.polycount.min || polycount > settings.polycount.max) throw new Model3DGenerationError(`Meshy face count must be between ${settings.polycount.min} and ${settings.polycount.max}`, 400);
  const texture = input.texture ?? settings.defaults?.texture ?? settings.supportsTexture;
  const pbr = texture && (input.pbr ?? settings.defaults?.pbr ?? false);
  if (texture && !settings.supportsTexture || pbr && !settings.supportsPbr) throw new Model3DGenerationError("The selected 3D model does not support these texture options", 400);
  if (operation === "text") {
    if (images.length || !input.prompt?.trim() || input.prompt.length > 800) throw new Model3DGenerationError("Meshy text generation needs a prompt up to 800 characters", 400);
    return { endpoint: "text-to-3d", body: {
      mode: "preview",
      prompt: input.prompt,
      ai_model: input.model.id,
      model_type: settings.modelType,
      ...settings.modelType === "standard" ? { should_remesh: true } : {},
      target_polycount: polycount,
      topology: "triangle",
      ...input.options?.pose ? { pose_mode: input.options.pose } : {}
    } };
  }
  return { endpoint: settings.operation, body: {
    ...settings.operation === "image-to-3d" ? { image_url: images[0] } : { image_urls: images },
    ...input.options?.pose ? { pose_mode: input.options.pose } : {},
    ai_model: input.model.id,
    should_texture: texture,
    enable_pbr: pbr,
    target_polycount: polycount,
    ...settings.modelType === "smart-topology" ? { model_type: "smart-topology" } : { should_remesh: true, topology: "triangle" }
  } };
}
function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function string(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function httpUrl(value) {
  return Boolean(string(value)?.match(/^https?:\/\//));
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

// vendor/daemon/tripo-provider.ts
var import_promises = require("node:timers/promises");
var BASE_URL2 = "https://openapi.tripo3d.ai/v3";
var VIEW_NAMES = ["front", "left", "back", "right"];
var TripoProvider = class {
  constructor(apiKey, request = fetch, pollIntervalMs = 2e3, isEnabled = () => true, connection) {
    this.apiKey = apiKey;
    this.request = request;
    this.pollIntervalMs = pollIntervalMs;
    this.isEnabled = isEnabled;
    this.connection = connection;
  }
  async generate(input, signal, settings) {
    const model = settings ?? this.connection?.settings ?? model3DPreset(input.model.provider, input.model.id)?.settings;
    if (!model || model.protocol !== "tripo") throw new Model3DGenerationError("The selected Tripo model is unavailable", 400);
    const operation = input.operation ?? "image";
    if (input.options?.textureQuality === "fast" && input.options?.textureModel && input.options.textureModel !== "v3.5-20260815") throw new Model3DGenerationError("Fast textures require Tripo v3.5", 400);
    if (operation === "image" && (!input.images.length || input.images.length > model.maxReferenceImages)) throw new Model3DGenerationError(`Provide 1 to ${model.maxReferenceImages} reference images`, 400);
    if (operation === "text" && (input.images.length || !input.prompt?.trim() || input.prompt.length > 1024)) throw new Model3DGenerationError("Tripo text generation needs a prompt up to 1024 characters", 400);
    const polycount = operation === "remesh" ? remeshPolycount("tripo") : model.polycount;
    const faces = input.targetPolycount ?? polycount.default;
    if (operation !== "retexture" && (!Number.isInteger(faces) || faces < polycount.min || faces > polycount.max)) throw new Model3DGenerationError(`Tripo face count must be between ${polycount.min} and ${polycount.max}`, 400);
    const texture = input.texture ?? model.defaults?.texture ?? model.supportsTexture;
    const pbr = texture && (input.pbr ?? model.defaults?.pbr ?? false);
    if (texture && !model.supportsTexture || pbr && !model.supportsPbr) throw new Model3DGenerationError("The selected 3D model does not support these texture options", 400);
    return this.session(signal, async (key, requestSignal) => {
      let endpoint2, body;
      if (operation === "retexture" || operation === "remesh") {
        if (!input.source?.length) throw new Model3DGenerationError("Choose a source GLB", 400);
        const source = await this.upload(input.source, "model/gltf-binary", "model.glb", key, requestSignal, input.execution, "source-upload");
        if (operation === "remesh") {
          endpoint2 = "mesh/decimate";
          body = { input: source, model: "v3.0", face_limit: faces, quad: false, bake: true };
        } else {
          if (input.images.length > 1 || input.images.length && input.prompt?.trim()) throw new Model3DGenerationError("Choose one texture image or a prompt", 400);
          const version = input.options?.textureModel ?? "v3.5-20260815";
          if (!["v3.5-20260815", "v3.0-20250812", "v2.5-20250123"].includes(version)) throw new Model3DGenerationError("Unsupported Tripo texture version", 400);
          const image = input.images[0];
          const token = image ? await this.imageUpload(image, key, requestSignal, input.execution, "texture-upload") : void 0;
          endpoint2 = "models/texture";
          body = {
            input: source,
            model: version,
            pbr: input.pbr ?? false,
            texture_prompt: token ? { image: token } : { text: input.prompt },
            texture_quality: input.options?.textureQuality ?? "standard"
          };
        }
      } else {
        const tokens = [];
        for (const [index, image] of input.images.entries()) tokens.push(await this.imageUpload(image, key, requestSignal, input.execution, `image-upload-${index}`));
        endpoint2 = `generation/${operation === "text" ? "text-to-model" : tokens.length === 1 ? "image-to-model" : "multiview-to-model"}`;
        body = {
          model: input.model.id,
          face_limit: faces,
          texture,
          pbr,
          ...operation === "text" ? { prompt: input.prompt } : tokens.length === 1 ? { input: tokens[0] } : { inputs: tokens.map((token, index) => ({ [VIEW_NAMES[index]]: token })) }
        };
      }
      const { taskId, task } = await this.task(endpoint2, body, key, requestSignal, input.execution, "generate");
      return {
        bytes: await this.download(task, requestSignal),
        mediaType: "model/gltf-binary",
        requestId: taskId,
        ...operation === "image" || operation === "text" ? { metadata: { forwardAxis: "+X" } } : {}
      };
    });
  }
  async animations(_signal, _model, options) {
    if (options?.rigModel && !["v1.0-20240301", "v2.5-20260210", "v3.0-20260909"].includes(options.rigModel) || options?.rigType && !["biped", "quadruped", "hexapod", "octopod", "serpentine", "aquatic"].includes(options.rigType) || (options?.rigModel ?? "v1.0-20240301") === "v1.0-20240301" && options?.rigType && options.rigType !== "biped") throw new Model3DGenerationError("Unsupported Tripo rig version or type", 400);
    return tripoActions(options?.rigModel, options?.rigType);
  }
  async animate(input, signal) {
    const rigModel = input.options?.rigModel ?? "v1.0-20240301", rigType = input.options?.rigType ?? "biped";
    const available = new Set((await this.animations(void 0, void 0, input.options)).map((action) => action.id));
    if (!input.actionIds.length || input.actionIds.length > MAX_ANIMATION_ACTIONS || input.actionIds.some((action) => typeof action !== "string" || !available.has(action))) throw new Model3DGenerationError("Choose actions from the selected Tripo rig's presets", 400);
    return this.session(signal, async (key, requestSignal) => {
      const source = await this.upload(input.model, "model/gltf-binary", "model.glb", key, requestSignal, input.execution, "source-upload");
      const check = await this.task("animations/rig-check", { input: source }, key, requestSignal, input.execution, "rig-check");
      const output = record2(check.task.output);
      if (output.riggable !== true || output.rig_type !== rigType) throw new Model3DGenerationError(`Tripo rig check requires ${String(output.rig_type ?? "a riggable model")}; choose the matching rig type`, 400);
      const rig = await this.task("animations/rig", { input: source, model: rigModel, rig_type: rigType, spec: "tripo", out_format: "glb" }, key, requestSignal, input.execution, "rig");
      const result = await this.task("animations/retarget", {
        input: rig.taskId,
        animations: input.actionIds,
        out_format: "glb",
        bake_animation: true,
        export_with_geometry: true,
        animate_in_place: input.options?.animateInPlace ?? false
      }, key, requestSignal, input.execution, "animation");
      return { bytes: await this.download(result.task, requestSignal), mediaType: "model/gltf-binary", requestId: result.taskId };
    });
  }
  async accountBalance(signal) {
    return this.session(signal, async (key, requestSignal) => {
      const value = await this.json("account/balance", { signal: requestSignal }, key);
      if (typeof value.balance !== "number") throw new Model3DGenerationError("Tripo returned an invalid balance");
      return { balance: value.balance, ...typeof value.frozen === "number" ? { frozen: value.frozen } : {} };
    });
  }
  async session(signal, run) {
    if (!this.isEnabled()) throw new Model3DGenerationError("Tripo provider is disabled", 409);
    const key = this.apiKey();
    if (!key && this.connection?.authentication !== "none") throw new Model3DGenerationError("Tripo API key is not configured", 503);
    const timeout = AbortSignal.timeout(60 * 6e4), combined = AbortSignal.any([timeout, ...signal ? [signal] : []]);
    try {
      combined.throwIfAborted();
      return await run(key, combined);
    } catch (cause) {
      if (timeout.aborted && !signal?.aborted) throw new Model3DGenerationError("Tripo operation timed out; retry to resume the submitted task", 504);
      throw cause;
    }
  }
  scope(key) {
    return JSON.stringify([this.connection?.baseUrl ?? BASE_URL2, key, this.connection?.headers, this.connection?.authentication]);
  }
  async imageUpload(image, key, signal, execution, stage) {
    const bytes = Buffer.from(image.data, "base64");
    if (!["image/png", "image/jpeg"].includes(image.mediaType) || !bytes.length || bytes.length > 20 * 1024 * 1024) throw new Model3DGenerationError("Tripo references must be PNG or JPEG images up to 20 MB", 400);
    return this.upload(bytes, image.mediaType, image.mediaType === "image/png" ? "reference.png" : "reference.jpg", key, signal, execution, stage);
  }
  async upload(bytes, mediaType, name, key, signal, execution, stage) {
    const submit = async () => {
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(bytes)], { type: mediaType }), name);
      const uploaded = await this.json("files", { method: "POST", body: form, signal }, key);
      if (typeof uploaded.file_token !== "string" || !uploaded.file_token) throw new Model3DGenerationError("Tripo returned no upload token");
      return { token: uploaded.file_token };
    };
    const result = execution ? await execution.submitted(stage, this.scope(key), { bytes: bytes.toString("base64"), mediaType }, submit) : await submit();
    return result.token;
  }
  async task(endpoint2, body, key, signal, execution, stage = endpoint2) {
    const submit = async () => {
      const value = await this.json(endpoint2, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }, key);
      if (typeof value.task_id !== "string" || !value.task_id) throw new Model3DGenerationError("Tripo returned no task ID");
      return { taskId: value.task_id };
    };
    const { taskId } = execution ? await execution.submitted(stage, this.scope(key), { endpoint: endpoint2, body }, submit) : await submit();
    let failures = 0;
    while (true) {
      signal.throwIfAborted();
      let task;
      try {
        task = await this.json(`tasks/${encodeURIComponent(taskId)}`, { signal }, key);
        failures = 0;
      } catch (cause) {
        if (!(cause instanceof TripoNetworkError) || ++failures >= 3) throw cause;
        await (0, import_promises.setTimeout)(this.pollIntervalMs, void 0, { signal });
        continue;
      }
      if (task.status === "success") return { taskId, task };
      if (["failed", "cancelled", "canceled"].includes(String(task.status))) throw new Model3DGenerationError(typeof task.error_message === "string" ? task.error_message : `Tripo task ${task.status}`, 400);
      if (!["queued", "running"].includes(String(task.status))) throw new Model3DGenerationError("Tripo returned an unknown task status");
      await (0, import_promises.setTimeout)(this.pollIntervalMs, void 0, { signal });
    }
  }
  async download(task, signal) {
    const url = record2(task.output).model_url;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new Model3DGenerationError("Tripo completed without a GLB artifact");
    const response = await this.request(url, { signal });
    if (!response.ok) throw new Model3DGenerationError(`Tripo GLB download failed (${response.status})`);
    return readModel3DResult(response);
  }
  async json(endpoint2, init, key) {
    let response;
    try {
      response = await this.request(`${(this.connection?.baseUrl ?? BASE_URL2).replace(/\/+$/, "")}/${endpoint2}`, {
        ...init,
        signal: AbortSignal.any([AbortSignal.timeout(6e4), ...init.signal ? [init.signal] : []]),
        headers: { ...this.connection?.headers, ...this.connection?.authentication === "none" ? {} : { authorization: `Bearer ${key}` }, ...init.headers }
      });
    } catch (cause) {
      if (init.signal?.aborted) throw init.signal.reason ?? cause;
      throw new TripoNetworkError(`Could not reach Tripo (${cause instanceof Error ? cause.message : String(cause)})`);
    }
    const body = record2(await response.json().catch(() => void 0));
    if (response.ok && body.code === 0 && body.data && typeof body.data === "object") return record2(body.data);
    const message = typeof body.message === "string" ? body.message : "Invalid API response";
    if (response.status === 401 || body.code === 1e3 || body.code === 1001) throw new Model3DGenerationError("Tripo API key was rejected", 503);
    if (response.status === 429 || body.code === 2e3) throw new Model3DGenerationError("Tripo is temporarily rate limited", 429);
    throw new Model3DGenerationError(`Tripo: ${message}`, response.status >= 500 || response.ok ? 502 : 400);
  }
};
var TripoNetworkError = class extends Model3DGenerationError {
  constructor(message) {
    super(message, 502);
  }
};
function record2(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// vendor/daemon/hyper3d-provider.ts
var import_promises2 = require("node:timers/promises");
var API = "https://api.hyper3d.com/api/v2";
var Hyper3DProvider = class {
  constructor(apiKey, request = fetch, pollIntervalMs = 5e3, isEnabled = () => true, connection) {
    this.apiKey = apiKey;
    this.request = request;
    this.pollIntervalMs = pollIntervalMs;
    this.isEnabled = isEnabled;
    this.connection = connection;
  }
  async generate(input, signal, settings) {
    if (!this.isEnabled()) throw new Model3DGenerationError("Hyper3D provider is disabled", 409);
    const key = this.apiKey();
    if (!key && this.connection?.authentication !== "none") throw new Model3DGenerationError("Hyper3D API key is not configured", 503);
    const model = settings ?? this.connection?.settings ?? model3DPreset(input.model.provider, input.model.id)?.settings;
    if (!model || model.protocol !== "hyper3d") throw new Model3DGenerationError("The selected Hyper3D model is unavailable", 400);
    const operation = input.operation ?? "image";
    if (operation === "remesh") throw new Model3DGenerationError("Hyper3D does not support remeshing", 400);
    if (operation === "text" && (input.images.length || !input.prompt?.trim())) throw new Model3DGenerationError("Add a text prompt without reference images", 400);
    if (operation === "retexture" && (!input.source?.length || input.images.length !== 1)) throw new Model3DGenerationError("Hyper3D retexture requires one source GLB and one reference image", 400);
    if (operation === "image" && (!input.images.length || input.images.length > model.maxReferenceImages)) throw new Model3DGenerationError(`Provide 1 to ${model.maxReferenceImages} reference images`, 400);
    const faces = input.targetPolycount ?? model.polycount.default;
    if (operation !== "retexture" && (!Number.isInteger(faces) || faces < model.polycount.min || faces > model.polycount.max)) throw new Model3DGenerationError(`Hyper3D face count must be between ${model.polycount.min} and ${model.polycount.max}`, 400);
    const texture = input.texture ?? model.defaults?.texture ?? model.supportsTexture;
    const pbr = texture && (input.pbr ?? model.defaults?.pbr ?? false);
    if (texture && !model.supportsTexture || pbr && !model.supportsPbr) throw new Model3DGenerationError("The selected model does not support these texture options", 400);
    const form = new FormData();
    let size = 0;
    input.images.forEach((image, index) => {
      if (!["image/png", "image/jpeg"].includes(image.mediaType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Model3DGenerationError("Hyper3D references must be PNG or JPEG", 400);
      const bytes = Buffer.from(image.data, "base64");
      size += bytes.length;
      if (!bytes.length || size > 20 * 1024 * 1024) throw new Model3DGenerationError("Hyper3D references must total at most 20 MB", 413);
      form.append(operation === "retexture" ? "image" : "images", new Blob([bytes], { type: image.mediaType }), `reference-${index}.${image.mediaType === "image/png" ? "png" : "jpg"}`);
    });
    if (input.prompt?.trim()) form.set("prompt", input.prompt.trim());
    if (operation === "retexture") form.append("model", new Blob([new Uint8Array(input.source)], { type: "model/gltf-binary" }), "model.glb");
    if (input.options?.pose) form.set("TAPose", "true");
    if (operation !== "retexture") form.set("tier", input.model.id);
    if (operation !== "retexture" && input.model.id.startsWith("Gen-2.5-")) form.set("texture_mode", "medium");
    form.set("geometry_file_format", "glb");
    if (operation !== "retexture") {
      form.set("mesh_mode", "Raw");
      form.set("quality_override", String(faces));
    }
    form.set("material", operation !== "retexture" && !texture ? "None" : pbr ? "PBR" : "Shaded");
    if (operation === "retexture") form.set("resolution", "Basic");
    const timeout = AbortSignal.timeout(60 * 6e4);
    const combined = AbortSignal.any([timeout, ...signal ? [signal] : []]);
    try {
      const endpoint2 = operation === "retexture" ? "rodin_texture_only" : "rodin";
      const submit = async () => {
        const submitted = await this.json(endpoint2, key, { method: "POST", body: form, signal: combined });
        const uuid3 = submitted.uuid, subscriptionKey2 = record3(submitted.jobs).subscription_key;
        if (typeof uuid3 !== "string" || !uuid3 || typeof subscriptionKey2 !== "string" || !subscriptionKey2) throw new Model3DGenerationError("Hyper3D returned no task credentials. Check your provider dashboard before retrying");
        return { uuid: uuid3, subscriptionKey: subscriptionKey2 };
      };
      const execution = input.execution;
      const fingerprintInput = await Promise.all([...form].map(async ([name, value]) => [name, typeof value === "string" ? value : Buffer.from(await value.arrayBuffer()).toString("base64")]));
      const { uuid: uuid2, subscriptionKey } = execution ? await execution.submitted("generate", JSON.stringify([this.connection?.baseUrl ?? API, key, this.connection?.headers, this.connection?.authentication]), fingerprintInput, submit) : await submit();
      while (true) {
        await (0, import_promises2.setTimeout)(this.pollIntervalMs, void 0, { signal: combined });
        let status;
        try {
          status = await this.json("status", key, { method: "POST", signal: combined, headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription_key: subscriptionKey }) });
        } catch (cause) {
          if (cause instanceof Hyper3DThrottled) {
            await (0, import_promises2.setTimeout)(cause.retryAfterMs, void 0, { signal: combined });
            continue;
          }
          throw cause;
        }
        const jobs = Array.isArray(status.jobs) ? status.jobs.map((job) => record3(job).status) : [];
        if (!jobs.length || jobs.some((state) => !["Waiting", "Generating", "Done", "Failed"].includes(String(state)))) throw new Model3DGenerationError("Hyper3D returned an invalid task status");
        if (jobs.includes("Failed")) throw new Model3DGenerationError("Hyper3D could not generate this model", 400);
        if (!jobs.every((state) => state === "Done")) continue;
        const downloaded = await this.json("download", key, { method: "POST", signal: combined, headers: { "content-type": "application/json" }, body: JSON.stringify({ task_uuid: uuid2 }) });
        const file = Array.isArray(downloaded.list) ? downloaded.list.map(record3).find((item) => typeof item.name === "string" && item.name.toLowerCase().endsWith(".glb")) : void 0;
        let url;
        try {
          url = new URL(String(file?.url));
        } catch {
          throw new Model3DGenerationError("Hyper3D completed without a GLB artifact");
        }
        if (url.protocol !== "https:" || url.username || url.password) throw new Model3DGenerationError("Hyper3D completed without a valid GLB artifact");
        try {
          const response = await this.request(url.href, { signal: combined });
          if (!response.ok) throw new Model3DGenerationError("Hyper3D GLB download failed");
          return { bytes: await readModel3DResult(response), mediaType: "model/gltf-binary", requestId: uuid2 };
        } catch (cause) {
          if (combined.aborted || cause instanceof Model3DGenerationError) throw cause;
          throw new Model3DGenerationError("Hyper3D GLB download failed");
        }
      }
    } catch (cause) {
      if (timeout.aborted && !signal?.aborted) throw new Model3DGenerationError("Hyper3D generation timed out", 504);
      throw cause;
    }
  }
  async accountBalance(signal) {
    if (!this.isEnabled()) throw new Model3DGenerationError("Hyper3D provider is disabled", 409);
    const key = this.apiKey();
    if (!key && this.connection?.authentication !== "none") throw new Model3DGenerationError("Hyper3D API key is not configured", 503);
    const value = await this.json("check_balance", key, { signal });
    if (typeof value.balance !== "number") throw new Model3DGenerationError("Hyper3D returned an invalid balance");
    return { balance: value.balance };
  }
  async json(endpoint2, key, init) {
    let response;
    try {
      response = await this.request(`${(this.connection?.baseUrl ?? API).replace(/\/+$/, "")}/${endpoint2}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(6e4), ...init.signal ? [init.signal] : []]),
        headers: { ...this.connection?.headers, ...this.connection?.authentication === "none" ? {} : { authorization: `Bearer ${key}` }, ...init.headers }
      });
    } catch (cause) {
      if (init.signal?.aborted) throw cause;
      throw new Model3DGenerationError(endpoint2 === "rodin" || endpoint2 === "rodin_texture_only" ? "Hyper3D submission could not be confirmed. Check your provider dashboard before retrying" : "Could not reach Hyper3D");
    }
    const body = record3(await response.json().catch(() => void 0));
    if (response.ok && (!body.error || Array.isArray(body.error) && body.error.length === 0)) return body;
    if (response.status === 401 || response.status === 403) throw new Model3DGenerationError("Hyper3D API key was rejected", 503);
    if (response.status === 429 || body.error === "API_PARALLELISM_LIMIT_REACHED") {
      const retry = response.headers.get("retry-after");
      const ms = retry ? /^\d+$/.test(retry) ? Number(retry) * 1e3 : Date.parse(retry) - Date.now() : 5e3;
      throw new Hyper3DThrottled(Number.isFinite(ms) ? Math.max(5e3, Math.min(3e5, ms)) : 5e3);
    }
    const messages = { API_INSUFFICIENT_FUNDS: "Your Hyper3D credits are insufficient", API_OBJECT_NOT_FOUND_ON_IMAGE: "No supported object was found in the reference image", IMAGE_CONTENT_VIOLATION: "Hyper3D could not accept the reference image" };
    throw new Model3DGenerationError(messages[String(body.error)] ?? "Hyper3D could not accept this request", response.status >= 500 ? 502 : 400);
  }
};
var Hyper3DThrottled = class extends Model3DGenerationError {
  constructor(retryAfterMs) {
    super("Hyper3D is temporarily rate limited", 429);
    this.retryAfterMs = retryAfterMs;
  }
};
function record3(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// vendor/daemon/model3d-journal.ts
var import_node_crypto2 = require("node:crypto");
var import_promises3 = require("node:fs/promises");
var import_node_path = __toESM(require("node:path"));
var submissions = /* @__PURE__ */ new Map();
async function model3DJournal(directory, id) {
  if (!/^[a-zA-Z0-9-]{1,120}$/.test(id)) throw new Model3DGenerationError("Invalid task recovery ID", 400);
  await (0, import_promises3.mkdir)(directory, { recursive: true });
  const file = import_node_path.default.resolve(directory, `${id}.json`);
  return {
    async submitted(stage, scope, input, create2) {
      const pending = (submissions.get(file) ?? Promise.resolve()).catch(() => void 0).then(async () => {
        let entries = {};
        try {
          entries = JSON.parse(await (0, import_promises3.readFile)(file, "utf8"));
        } catch (cause) {
          if (cause.code !== "ENOENT") throw cause;
        }
        const save = async () => {
          try {
            await (0, import_promises3.writeFile)(`${file}.tmp`, JSON.stringify(entries), { mode: 384 });
            await (0, import_promises3.rename)(`${file}.tmp`, file);
          } catch (cause) {
            await (0, import_promises3.rm)(`${file}.tmp`, { force: true }).catch(() => void 0);
            throw cause;
          }
        };
        const fingerprint = (0, import_node_crypto2.createHash)("sha256").update(scope).update(JSON.stringify(input)).digest("hex");
        const previous = entries[stage];
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new Model3DGenerationError("Provider connection or input changed. Restore the original settings to resume, or start a new generation.", 409);
          if (!previous.credentials) throw new Model3DGenerationError("Submission could not be confirmed. Check the provider dashboard before starting a new generation; retry will not submit another paid task.", 409);
          return previous.credentials;
        }
        entries[stage] = { fingerprint };
        await save();
        let credentials;
        try {
          credentials = await create2();
        } catch (cause) {
          if (cause instanceof Model3DGenerationError && [400, 429].includes(cause.statusCode)) {
            delete entries[stage];
            await save();
          }
          throw cause;
        }
        entries[stage] = { fingerprint, credentials };
        await save();
        return credentials;
      });
      submissions.set(file, pending);
      try {
        return await pending;
      } finally {
        if (submissions.get(file) === pending) submissions.delete(file);
      }
    }
  };
}

// worker.ts
var emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
async function main() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    const task = JSON.parse(text);
    if (task.command === "catalog") {
      emit({ result: Object.entries(MODEL_3D_PRESETS).map(([id, models]) => ({ id, models, operations: protocolOperations(id) })) });
    } else if (task.command === "validate") {
      emit({ result: task.models.map((model) => normalizeNativeModel3D(task.protocol, model)) });
    } else {
      const { connection, input = {} } = task;
      const protocol = connection.protocol;
      const settings = connection.settings;
      const available = connection.models ?? MODEL_3D_PRESETS[protocol];
      const definition = available.find((m) => m.id === task.model);
      if (!definition) throw new Error("\u6240\u9009 3D \u6A21\u578B\u7248\u672C\u4E0D\u53EF\u7528");
      const selected = normalizeNativeModel3D(protocol, definition);
      const Provider = { meshy: MeshyProvider, tripo: TripoProvider, hyper3d: Hyper3DProvider }[protocol];
      if (!Provider) throw new Error("\u4E0D\u652F\u6301\u7684 3D \u670D\u52A1\u534F\u8BAE");
      const request = async (url, init) => {
        const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(12e4) });
        if (String(url).startsWith(connection.baseUrl) && init?.method === "GET" && response.ok) {
          try {
            const body = await response.clone().json();
            const state = body.data ?? body;
            if (typeof state.progress === "number" || state.status) emit({ progress: state.progress, status: String(state.status ?? "") });
          } catch {
          }
        }
        return response;
      };
      const generator = new Provider(
        () => connection.apiKey,
        request,
        2e3,
        () => true,
        { ...connection, settings: selected.settings }
      );
      const model = { provider: protocol, id: task.model };
      let result;
      if (task.command === "balance") result = await generator.accountBalance();
      else if (task.command === "animations") {
        if (!generator.animations) throw new Error("\u6B64\u670D\u52A1\u4E0D\u652F\u6301\u52A8\u753B");
        result = await generator.animations(void 0, model, input.options);
      } else {
        const journal = await model3DJournal(task.directory, task.recoveryId);
        const execution = { submitted: async (stage, scope, body, create2) => {
          emit({ stage });
          return journal.submitted(stage, scope, body, create2);
        } };
        const source = task.source ? await (0, import_promises4.readFile)(task.source) : void 0;
        const images = await Promise.all((task.images ?? []).map(async (image) => ({ mediaType: image.mime, data: (await (0, import_promises4.readFile)(image.path)).toString("base64") })));
        const generated = task.command === "animate" ? await generator.animate({ ...input, model: source, providerModel: model, execution }) : await generator.generate({ ...input, source, images, model, execution }, void 0, selected.settings);
        const metadata = { ...await inspectModel3D(generated.bytes), ...generated.metadata };
        if (task.command === "animate" && !metadata.animations?.length) throw new Error("\u670D\u52A1\u8FD4\u56DE\u7684 GLB \u6CA1\u6709\u52A8\u753B\u7247\u6BB5\uFF0C\u672A\u91C7\u7528\u4E3A\u52A8\u753B\u7ED3\u679C");
        await (0, import_promises4.writeFile)(task.output, generated.bytes, { mode: 384 });
        result = { metadata, requestId: generated.requestId };
      }
      emit({ result });
    }
  } catch (error) {
    emit({ error: String(error?.message ?? error).slice(0, 1e3), statusCode: error?.statusCode ?? 502 });
    process.exitCode = 1;
  }
}
void main();
