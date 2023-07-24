import os
from pathlib import Path

from util import load_json_value, set_json_value,load_yaml


def set_openai_token(token: str):
    config_dir = Path(Path.home(), ".skyagi")
    if not config_dir.exists():
        config_dir.mkdir(parents=True)
    config_file = Path(config_dir, "config.json")
    set_json_value(config_file, "openai_token", token)


def set_pinecone_token(token: str):
    config_dir = Path(Path.home(), ".skyagi")
    if not config_dir.exists():
        config_dir.mkdir(parents=True)
    config_file = Path(config_dir, "config.json")
    set_json_value(config_file, "openai_token", token)


def set_discord_token(token: str):
    config_dir = Path(Path.home(), ".skyagi")
    if not config_dir.exists():
        config_dir.mkdir(parents=True)
    config_file = Path(config_dir, "config.json")
    set_json_value(config_file, "discord_token", token)


def load_pinecone_token() -> str:
    config_dir = Path(Path.home(), ".skyagi")
    if not config_dir.exists():
        return ""
    config_file = Path(config_dir, "config.json")
    return load_json_value(config_file, "pinecone_token", "")


def load_openai_token() -> str:
    try:
        return load_yaml("conf\\config.yaml")['openai-key'][0]
    except:
        config_dir = Path(Path.home(), ".skyagi")
        if not config_dir.exists():
            return ""
        config_file = Path(config_dir, "config.json")
        return load_json_value(config_file, "openai_token", "")


def load_discord_token() -> str:
    config_dir = Path(Path.home(), ".skyagi")
    if not config_dir.exists():
        return ""
    config_file = Path(config_dir, "config.json")
    return load_json_value(config_file, "discord_token", "")
