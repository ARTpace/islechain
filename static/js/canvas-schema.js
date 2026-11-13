/* Advisory only: backend validation remains authoritative. */
window.CanvasSchema = (() => {
    let schema = null;
    const ready = fetch('/static/schemas/canvas.schema.json?v=20261106')
        .then(response => response.ok ? response.json() : null)
        .then(value => { schema = value; })
        .catch(() => {});
    function validateCanvas(canvas) {
        const definition = schema?.$defs?.node;
        if (!definition) return [];
        const warnings = [];
        for (const [index, node] of (canvas.nodes || []).entries()) {
            const required = [...(definition.required || [])];
            for (const rule of definition.allOf || []) {
                if (rule.if?.properties?.type?.const === node.type) {
                    required.push(...(rule.then?.required || []));
                }
            }
            for (const field of required) {
                if (node[field] === undefined || node[field] === null) {
                    warnings.push(`/nodes/${index}/${field}: required`);
                }
            }
            const types = definition.properties?.type?.enum;
            if (types && !types.includes(node.type)) warnings.push(`/nodes/${index}/type: enum`);
            if (warnings.length >= 20) break;
        }
        return warnings.slice(0, 20);
    }
    return {load: () => ready, validateCanvas};
})();
