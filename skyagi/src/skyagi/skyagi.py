from typing import List

from rich.console import Console

from context import Context
from model import load_llm_from_config
from settings import Settings
from simulation.agent import GenerativeAgent
from simulation.simulation import (
    create_new_memory_retriever,
    interview_agent,
    run_conversation,
    talks_to,
)
from util import get_checkpoint_dir
import api.httpapi

import asyncio

agent_to_interview = {}
ctx = {}



def user_robot_conversation(_agent_to_interview: GenerativeAgent, _ctx: Context):
    
    def handle(input):
        response = interview_agent(
            _agent_to_interview, input, _ctx
        )
        return response
    
    api.httpapi.callback = handle
    api.httpapi.Run()
    
    exit()

def agi_step(ctx: Context, instruction: dict) -> None:
    ctx.clock += 1
    if instruction["command"] == "interview":
        user_robot_conversation(instruction["agent_to_interview"], ctx)

    if instruction["command"] == "continue":
        someone_asked = False
        for robot_agent in ctx.robot_agents:
            with ctx.console.status("[yellow]Something is going on..."):
                message = talks_to(robot_agent, ctx.user_agent, ctx.observations)
            if message:
                if someone_asked:
                    ctx.print(
                        f"{robot_agent.name} also whispered to you({ctx.user_agent.name}): {message}",
                        style="yellow",
                    )
                else:
                    ctx.print(
                        f"{robot_agent.name} whispered to you ({ctx.user_agent.name}): {message}",
                        style="yellow",
                    )
                someone_asked = True
                user_robot_conversation(robot_agent, ctx)

    ctx.print("The world has something else happening...", style="yellow")
    # let the activities of non user robots happen
    for idx in range(len(ctx.robot_agents) - 1):
        amy = ctx.robot_agents[idx]
        for bob in ctx.robot_agents[idx + 1 :]:
            message = talks_to(amy, bob, ctx.observations)
            if message:
                ctx.print(f"{amy.name} just whispered to {bob.name}...", style="yellow")
                with ctx.console.status(
                    f"[yellow]{amy.name} is having a private dicussion with {bob.name}..."
                ):
                    run_conversation([amy, bob], f"{amy.name} said: {message}", ctx)
                ctx.print(
                    f"{amy.name} and {bob.name} finished their private conversation...",
                    style="yellow",
                )
                continue
            message = talks_to(bob, amy, ctx.observations)
            if message:
                ctx.print(f"{bob.name} just whispered to {amy.name}...", style="yellow")
                run_conversation([bob, amy], f"{bob.name} said: {message}", ctx)
                ctx.print(
                    f"{bob.name} and {amy.name} finished their private conversation...",
                    style="yellow",
                )
                continue

    # clean up context's observations based on the time window
    ctx.observations_size_history.append(len(ctx.observations))
    if len(ctx.observations_size_history) > ctx.timewindow_size:
        remove_count = ctx.observations_size_history[0]
        ctx.observations = ctx.observations[remove_count:]
        ctx.observations_size_history = ctx.observations_size_history[1:]
        for idx in range(len(ctx.observations_size_history)):
            ctx.observations_size_history[idx] = (
                ctx.observations_size_history[idx] - remove_count
            )


def agi_init(
    agent_configs: List[dict],
    console: Console,
    settings: Settings,
    user_idx: int = 0,
    webcontext=None,
    from_checkpoint=False
) -> Context:
    ctx = Context(console, settings, webcontext)
    ctx.print("Creating all agents one by one...", style="yellow")
    for idx, agent_config in enumerate(agent_configs):
        agent_name = agent_config["name"]
        with ctx.console.status(f"[yellow]Creating agent {agent_name}..."):
            agent = GenerativeAgent(
                name=agent_config["name"],
                age=agent_config["age"],
                traits=agent_config["personality"],
                status="N/A",  # When connected to a virtual world, we can have the characters update their status
                memory_retriever=create_new_memory_retriever(ctx),
                llm=load_llm_from_config(ctx.settings.model.llm),
                daily_summaries=[(agent_config["current_status"])],
                reflection_threshold=8,
            )
            checkpoint_dir = get_checkpoint_dir(agent_config["path"])
            if from_checkpoint and agent.try_load_memory(checkpoint_dir):
                pass
            else:
                for memory in agent_config["memories"]:
                    agent.add_memory(memory)
                agent.dump_memory(checkpoint_dir)
        if idx == user_idx:
            ctx.user_agent = agent
        else:
            ctx.robot_agents.append(agent)
        ctx.agents.append(agent)
        ctx.observations.append(agent_config["current_status"])
        ctx.print(f"Agent {agent_name} successfully created", style="green")

    ctx.print("SkyAGI started...")
    ctx.print(f"You are going to behave as {ctx.user_agent.name}", style="yellow")
    return ctx
