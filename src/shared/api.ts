export interface SpecInfo {
  id: string;
  name: string;
  path: string;
  branch: string;
  createdAt: string;
}

export interface ProjectInfo {
  path: string;
  name: string;
  specs: SpecInfo[];
}

export interface ArtifactFiles {
  spec: string;
  userStories: string;
  technicalStories: string;
  code: string;
}

export interface SpecOpsApi {
  version: string;
  openProject(): Promise<ProjectInfo | null>;
  listSpecs(projectPath: string): Promise<SpecInfo[]>;
  createSpec(projectPath: string, name: string): Promise<SpecInfo>;
  readArtifacts(specPath: string): Promise<ArtifactFiles>;
  writeArtifact(
    specPath: string,
    artifact: keyof ArtifactFiles,
    content: string,
  ): Promise<void>;
}

declare global {
  interface Window {
    specops: SpecOpsApi;
  }
}

export {};
