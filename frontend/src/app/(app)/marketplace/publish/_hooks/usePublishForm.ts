import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreatePackage } from "@/hooks/useCodePackages";
import type {
  PackageCategory,
  PackageLicense,
  PackageVisibility,
  CreatePackageRequest,
} from "@/types/code-packages";
import type { PublishFormState } from "../types";

export function usePublishForm() {
  const router = useRouter();
  const createPackage = useCreatePackage();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<PackageCategory>("automation");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [license, setLicense] = useState<PackageLicense>("MIT");
  const [code, setCode] = useState("");
  const [readme, setReadme] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [homepageUrl, setHomepageUrl] = useState("");
  const [documentationUrl, setDocumentationUrl] = useState("");
  const [visibility, setVisibility] = useState<PackageVisibility>("public");

  const formState: PublishFormState = {
    name,
    description,
    category,
    tags,
    tagInput,
    license,
    code,
    readme,
    functionName,
    repositoryUrl,
    homepageUrl,
    documentationUrl,
    visibility,
  };

  const setters = {
    setName,
    setDescription,
    setCategory,
    setTags,
    setTagInput,
    setLicense,
    setCode,
    setReadme,
    setFunctionName,
    setRepositoryUrl,
    setHomepageUrl,
    setDocumentationUrl,
    setVisibility,
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag) && tags.length < 10) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const isFormValid = () => {
    return (
      name.trim() &&
      description.trim() &&
      code.trim() &&
      functionName.trim() &&
      category &&
      license &&
      visibility
    );
  };

  const handlePublish = async () => {
    if (!isFormValid()) return;

    const packageData: CreatePackageRequest = {
      name,
      description,
      category,
      tags,
      license,
      code,
      readme: readme || undefined,
      function_name: functionName,
      repository_url: repositoryUrl || undefined,
      homepage_url: homepageUrl || undefined,
      documentation_url: documentationUrl || undefined,
      visibility,
    };

    try {
      const newPackage = await createPackage.mutateAsync(packageData);
      router.push(`/marketplace/${newPackage.slug}`);
    } catch (error) {
      console.error("[PublishPackagePage] Failed to publish package:", error);
    }
  };

  const handleBack = () => {
    router.push("/marketplace");
  };

  return {
    formState,
    setters,
    handleAddTag,
    handleRemoveTag,
    isFormValid,
    handlePublish,
    handleBack,
    isPublishing: createPackage.isPending,
  };
}
