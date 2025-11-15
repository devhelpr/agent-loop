export interface ValidationError {
  file: string;
  line: number;
  column: number;
  message: string;
  code: string;
  severity: "error" | "warning" | "info";
}

export interface ValidationResult {
  success: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  fixedErrors?: ValidationError[];
}

export interface FileValidator {
  canValidate(filePath: string): boolean;
  validate(filePath: string, content: string): Promise<ValidationResult>;
  autoFix?(
    filePath: string,
    content: string,
    errors: ValidationError[]
  ): Promise<string>;
}

export class ValidatorRegistry {
  private validators: FileValidator[] = [];

  register(validator: FileValidator): void {
    this.validators.push(validator);
  }

  getValidator(filePath: string): FileValidator | null {
    return this.validators.find((v) => v.canValidate(filePath)) || null;
  }

  async validateFile(
    filePath: string,
    content: string
  ): Promise<ValidationResult> {
    const validator = this.getValidator(filePath);
    if (!validator) {
      return {
        success: true,
        errors: [],
        warnings: [],
      };
    }

    return await validator.validate(filePath, content);
  }

  async autoFixFile(
    filePath: string,
    content: string,
    errors: ValidationError[]
  ): Promise<string> {
    const validator = this.getValidator(filePath);
    if (!validator || !validator.autoFix) {
      return content;
    }

    return await validator.autoFix(filePath, content, errors);
  }
}

// Global registry instance
export const validatorRegistry = new ValidatorRegistry();
