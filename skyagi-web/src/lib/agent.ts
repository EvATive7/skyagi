import { TimeWeightedVectorStoreRetriever } from "langchain/retrievers/time_weighted";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { SupabaseVectorStore } from "langchain/vectorstores/supabase";
import { PromptTemplate } from "langchain/prompts";
import { LLMChain } from "langchain/chains";
import { Document } from "langchain/document";
import { ChatOpenAI } from "langchain/chat_models/openai";
import type { BaseLanguageModel } from "langchain/base_language";

function parseList(text: string): string[] {
	const lines = text.trim().split('\n');
	return lines.map(line => line.replace(/^\s*\d+\.\s*/, '').trim());
}

export class GenerativeAgent {
    id: string;
    name: string;
	age: number;
	personality: string;
	status: string;
	llm: BaseLanguageModel;
	memoryRetriever: TimeWeightedVectorStoreRetriever;

	maxTokensLimit: number = 1200;
	reflectionThreshold: number = 8;
	memoryImportance: number = 0.0;

    // TODO:
    // * support embeddings from different LLM models
    // * may define our own queryfunction
    // * standardize sql query later
    // * config llm based on the user's request
    constructor(supabase: any, conversationId: string, agentId: string, llm: any) {
        // get agent's profile
        const { data: profiles } = supabase
            .from('agent')
		    .select('id name age personality')
		    .eq('id', agentId);
        this.id = profiles.id;
        this.name = profiles.name;
        this.age = profiles.age;
        this.personality = profiles.personality;
        this.llm = new ChatOpenAI();

        // create retriever
        const vectorStore = new SupabaseVectorStore(
            new OpenAIEmbeddings(),
            {
                supabase,
                tableName: "memory"
            }
        );
        this.memoryRetriever = new TimeWeightedVectorStoreRetriever({
            vectorStore,
            otherScoreKeys: ["importance"],
            k: 15}
        );

        // get all memories
        const { data: allMemories } = supabase
            .from('memory')
		    .select('id content cur_status last_access_time')
		    .eq('conversation_id', conversationId)
		    .eq('agent_id', agentId)
            .order('last_access_time', { ascending: true });
        this.status = allMemories[allMemories.length - 1].cur_status;
 
        // add all memories to retriever
        for (const memory of allMemories) {
            this.memoryRetriever.addDocuments(memory.content);
        }
    }

    private fetchMemories(observation: string): Document[] {
		return this.memoryRetriever.getRelevantDocuments(observation);
	}

	private computeAgentSummary(): string {
		const prompt = PromptTemplate.fromTemplate(
			`How would you summarize ${this.name}'s core characteristics given the` +
				` following statements:\n` +
				`{related_memories}` +
				`Do not embellish.` +
				`\n\nSummary: `
		);
		const relevantMemories = this.fetchMemories(`${this.name}'s core characteristics`);
		const relevantMemoriesStr = relevantMemories.map(mem => mem.pageContent).join('\n');
		const chain = new LLMChain({llm: this.llm, prompt});
		return chain.run({ name: this.name, relatedMemories: relevantMemoriesStr }).trim();
	}

    private getEntityFromObservation(observation: string): string {
		const prompt = PromptTemplate.fromTemplate(
			`What is the observed entity in the following observation? ${observation}` + `\nEntity=`
		);
		const chain = new LLMChain({llm: this.llm, prompt});
		return chain.run({ observation: observation }).trim();
	}

    private getEntityAction(observation: string, entityName: string): string {
		const prompt = PromptTemplate.fromTemplate(
			`What is the {entity} doing in the following observation? ${observation}` +
				`\nThe {entity} is`
		);
		const chain = new LLMChain({llm: this.llm, prompt});
		return chain.run({ entity: entityName, observation: observation }).trim();
	}

    private formatMemoriesToSummarize(relevantMemories: Document[]): string {
		const contentStrs = new Set<string>();
		const content: string[] = [];

		for (const mem of relevantMemories) {
			if (contentStrs.has(mem.pageContent)) {

				continue;
			}

			contentStrs.add(mem.pageContent);
			const createdTime = mem.metadata.createdAt.toLocaleString('en-US', {
				month: 'long',
				day: 'numeric',
				year: 'numeric',
				hour: 'numeric',
				minute: 'numeric',
				hour12: true
			});

			content.push(`- ${createdTime}: ${mem.pageContent.trim()}`);
		}

		return content.join('\n');
	}

    // TODO
    // * cache summary in supabase memory table
	private getSummary(forceRefresh: boolean = false): string {
		let summary = this.computeAgentSummary();

		return (
			`Name: ${this.name} (age: ${this.age})` +
			`\nInnate traits: ${this.personality}` +
			`\n${summary}`
		);
	}

    private summarizeRelatedMemories(observation: string): string {
		const entityName = this.getEntityFromObservation(observation);
		const entityAction = this.getEntityAction(observation, entityName);
		const q1 = `What is the relationship between ${this.name} and ${entityName}`;
		let relevantMemories = this.fetchMemories(q1);
		const q2 = `${entityName} is ${entityAction}`;
		relevantMemories.concat(this.fetchMemories(q2));

		const contextStr = this.formatMemoriesToSummarize(relevantMemories);
		const prompt = PromptTemplate.fromTemplate(
			`${q1}?\nContext from memory:\n${contextStr}\nRelevant context: `
		);

		const chain = new LLMChain({llm: this.llm, prompt});
		return chain.run({ q1: q1, contextStr: contextStr.trim() }).trim();
	}

    private getMemoriesUntilLimit(consumedTokens: number): string {
		const result: string[] = [];

		for (const doc of this.memoryRetriever.memoryStream.slice().reverse()) {
			if (consumedTokens >= this.maxTokensLimit) {
				break;
			}

			consumedTokens += this.llm.getNumTokens(doc.pageContent);

			if (consumedTokens < this.maxTokensLimit) {
				result.push(doc.pageContent);
			}
		}

		return result.reverse().join('; ');
	}

    private scoreMemoryImportance(memoryContent: string, weight: number = 0.15): number {
		const prompt = PromptTemplate.fromTemplate(
			`On the scale of 1 to 10, where 1 is purely mundane` +
				` (e.g., brushing teeth, making bed) and 10 is` +
				` extremely poignant (e.g., a break up, college` +
				` acceptance), rate the likely poignancy of the` +
				` following piece of memory. Respond with a single integer.` +
				`\nMemory: {memoryContent}` +
				`\nRating: `
		);
		const chain = new LLMChain({llm : this.llm, prompt});
		const score = chain.run({ memoryContent: memoryContent }).trim();
		const match = score.match(/^\D*(\d+)/);
		if (match) {
			return (parseFloat(match[1]) / 10) * weight;
		} else {
			return 0.0;
		}
	}

    private getTopicsOfReflection(lastK: number = 50): [string, string, string] {
		const prompt = PromptTemplate.fromTemplate(
			`{observations}\n\n` +
				`Given only the information above, what are the 3 most salient` +
				` high-level questions we can answer about the subjects in the statements?` +
				` Provide each question on a new line.\n\n`
		);
		const reflectionChain = new LLMChain({llm : this.llm, prompt});
		const observations = this.memoryRetriever.memoryStream.slice(-lastK);
		const observationStr = observations.map(o => o.pageContent).join('\n');
		const result = reflectionChain.run({ observations: observationStr });
        const ress = parseList(result);
        return [ress[0], ress[1], ress[2]];
	}

    private getInsightsOnTopic(topic: string): string[] {
		const prompt = PromptTemplate.fromTemplate(
			`Statements about ${topic}\n` +
				`{relatedStatements}\n\n` +
				`What 5 high-level insights can you infer from the above statements?` +
				` (example format: insight (because of 1, 5, 3))`
		);
		const relatedMemories = this.fetchMemories(topic);
		const relatedStatements = relatedMemories
			.map((memory, i) => `${i + 1}. ${memory.pageContent}`)
			.join('\n');
		const reflectionChain = new LLMChain(
			{llm : this.llm, prompt}
		);
		const result = reflectionChain.run({ topic: topic, relatedStatements: relatedStatements });
		// TODO: Parse the connections between memories and insights
		return parseList(result);
	}

    private pauseToReflect(): string[] {
		const newInsights: string[] = [];
		const topics = this.getTopicsOfReflection();
		for (const topic of topics) {
			const insights = this.getInsightsOnTopic(topic);
			for (const insight of insights) {
				this.addMemory(insight);
			}
			newInsights.push(...insights);
		}
		return newInsights;
	}
    
    // TODO
    // * cache summary in supabase memory table
    generateRspn(observation: string, suffix: string): string {
		const prompt = PromptTemplate.fromTemplate(
			'{agentSummaryDescription}' +
				'\nIt is {currentTime}.' +
				"\n{agentName}'s status: {agentStatus}" +
				"\nSummary of relevant context from {agentName}'s memory:" +
				'\n{relevantMemories}' +
				'\nMost recent observations: {recentObservations}' +
				'\nObservation: {observation}' +
				'\n\n' +
				suffix
		);

		const agentSummaryDescription = this.getSummary();
		const relevantMemoriesStr = this.summarizeRelatedMemories(observation);
		const currentTimeStr = new Date().toLocaleString('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			hour12: true
		});

		let kwargs = {
			agentSummaryDescription,
			currentTime: currentTimeStr,
			relevantMemories: relevantMemoriesStr,
			agentName: this.name,
			observation,
			agentStatus: this.status,
            recentObservations: ""
		};

		const consumedTokens = this.llm.getNumTokens(
			prompt.format({...kwargs })
		);
		kwargs.recentObservations = this.getMemoriesUntilLimit(consumedTokens);

		const actionPredictionChain = new LLMChain({ llm: this.llm, prompt });
		const result = actionPredictionChain.run(kwargs);
		return result.trim();
	}

    // TODO
    // * need to add memory to vectorStore. Not sure if memoryRetriever would
    // do it automatically.
    // * If so, how to let the retriever know the schema of the table.
    addMemory(content: string): void {
        const importanceScore = this.scoreMemoryImportance(content);
		this.memoryImportance += importanceScore;
		const document = new Document({
			pageContent: content,
			metadata: { importance: importanceScore }
		});
		const result = this.memoryRetriever.addDocuments([document]);

		if (
			this.memoryImportance > this.reflectionThreshold &&
			this.status !== 'Reflecting'
		) {
			const oldStatus = this.status;
			this.status = 'Reflecting';
			this.pauseToReflect();
			this.memoryImportance = 0.0;
			this.status = oldStatus;
		}
    }
}