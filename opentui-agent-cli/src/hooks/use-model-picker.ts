import type { KeyEvent } from "@opentui/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  listAgentModels,
  switchAgentModel,
} from "../agent/runtime/runtime";
import type { AgentModelOption } from "../agent/runtime/model-types";

type UseModelPickerParams = {
  onModelChanged: (label: string) => void;
};

type UseModelPickerResult = {
  visible: boolean;
  loading: boolean;
  switching: boolean;
  error: string | null;
  search: string;
  options: AgentModelOption[];
  selectedIndex: number;
  open: () => void;
  close: () => void;
  setSearch: (value: string) => void;
  setSelectedIndex: (value: number) => void;
  handleListKeyDown: (event: KeyEvent) => boolean;
  confirmSelected: () => Promise<boolean>;
};

const normalize = (value: string) => value.trim().toLowerCase();

export const useModelPicker = ({ onModelChanged }: UseModelPickerParams): UseModelPickerResult => {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allOptions, setAllOptions] = useState<AgentModelOption[]>([]);
  const requestIdRef = useRef(0);

  const options = useMemo(() => {
    const query = normalize(search);
    if (!query) {
      return allOptions;
    }

    return allOptions.filter((item) => {
      const provider = item.provider.toLowerCase();
      const id = item.id.toLowerCase();
      const name = item.name.toLowerCase();
      return provider.includes(query) || id.includes(query) || name.includes(query);
    });
  }, [allOptions, search]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (selectedIndex < options.length) {
      return;
    }
    setSelectedIndex(0);
  }, [options.length, selectedIndex]);

  const close = useCallback(() => {
    requestIdRef.current += 1;
    setVisible(false);
    setLoading(false);
    setSwitching(false);
    setError(null);
    setSearch("");
    setSelectedIndex(0);
  }, []);

  const open = useCallback(() => {
    setVisible(true);
    setLoading(true);
    setError(null);
    setSearch("");
    setSelectedIndex(0);
    setAllOptions([]);
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    void listAgentModels()
      .then((models) => {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setAllOptions(models);
      })
      .catch((loadError) => {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setLoading(false);
      });
  }, []);

  const confirmSelected = useCallback(async (): Promise<boolean> => {
    const selected = options[selectedIndex];
    if (!selected || !visible || loading || switching) {
      return false;
    }

    if (!selected.configured) {
      setError(`Missing env ${selected.apiKeyEnv} for ${selected.id}.`);
      return true;
    }

    try {
      setSwitching(true);
      setError(null);
      const changed = await switchAgentModel(selected.id);
      setAllOptions((prev) =>
        prev.map((item) => ({
          ...item,
          current: item.id === changed.modelId,
        })),
      );
      onModelChanged(changed.modelLabel);
      close();
      return true;
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : String(switchError));
      return true;
    } finally {
      setSwitching(false);
    }
  }, [close, loading, onModelChanged, options, selectedIndex, switching, visible]);

  const handleListKeyDown = useCallback(
    (event: KeyEvent): boolean => {
      if (!visible) {
        return false;
      }

      const name = (event.name ?? "").toLowerCase();
      const ctrlOnly = !!event.ctrl && !event.shift && !event.meta;
      const isUp = name === "up" || (ctrlOnly && name === "p");
      const isDown = name === "down" || (ctrlOnly && name === "n");

      if (isUp) {
        if (options.length > 0) {
          setSelectedIndex((current) => (current - 1 + options.length) % options.length);
        }
        event.preventDefault();
        return true;
      }

      if (isDown) {
        if (options.length > 0) {
          setSelectedIndex((current) => (current + 1) % options.length);
        }
        event.preventDefault();
        return true;
      }

      if (name === "escape") {
        close();
        event.preventDefault();
        return true;
      }

      if (name === "return" || name === "enter") {
        void confirmSelected();
        event.preventDefault();
        return true;
      }

      return false;
    },
    [close, confirmSelected, options.length, visible],
  );

  return {
    visible,
    loading,
    switching,
    error,
    search,
    options,
    selectedIndex,
    open,
    close,
    setSearch,
    setSelectedIndex,
    handleListKeyDown,
    confirmSelected,
  };
};
