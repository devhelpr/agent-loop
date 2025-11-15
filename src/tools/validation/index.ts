import { TypeScriptValidator } from "./typescript-validator";
import { validatorRegistry } from "./validator-registry";

// Register default validators
validatorRegistry.register(new TypeScriptValidator());

export * from "./validator-registry";
export * from "./typescript-validator";
