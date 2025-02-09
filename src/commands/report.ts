require('dotenv-extended').load();
import { SlashCommandBuilder } from '@discordjs/builders';
import Discord, {
  MessageActionRow,
  MessageButton,
  MessageSelectMenu,
} from 'discord.js';
import logger from '../logger';
import { dispositionEntries, reportEmbedFields } from '../types/report';

import { dispositions, ICommand, SlashCommand } from '../types/typedefs';

enum actions {
  RESOLVE_REPORT = 0,
  CANCEL_REPORT = 1,
}

export default class Report implements ICommand {
  readonly command: SlashCommand = new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report an incident to a staff member.')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('User to be reported')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('details')
        .setDescription('Details describing what you are reporting')
        .setRequired(true)
    );

  async execute(interaction: Discord.CommandInteraction) {
    const { guild, client, user, channelId, options } = interaction;

    await logger.trace('Executing /report slash command');

    // Report indicator in channel where report was created
    const report = new Discord.MessageEmbed({
      color: 16645888,
      description: '',
      fields: reportEmbedFields,
      timestamp: new Date(),
      footer: {
        icon_url: client.user.avatarURL(),
        text: 'Reported',
      },
    });

    let r;

    // Send report embed to channel reported in
    try {
      r = await (<Discord.TextChannel>guild.channels.cache.get(channelId)).send(
        {
          content: `<@&${process.env.STAFF_REPORT_ROLE_ID}>`,
          embeds: [report],
        }
      );
    } catch (error) {
      await interaction.reply({
        content: 'Could not record report.',
        ephemeral: true,
      });

      await logger.error(error, '/report: Could not record report');
    }

    // Embed for staff channel
    const staff = new Discord.MessageEmbed({
      color: 16645888,
      fields: [
        {
          name: 'Reporter',
          value: `<@${user.id}>`,
          inline: true,
        },
        {
          name: 'Channel',
          value: `<#${channelId}>`,
          inline: true,
        },
        {
          name: 'Offender',
          value:
            options.getUser('user') !== null
              ? `${options.getUser('user')}`
              : 'No offender provided.',
          inline: true,
        },
        {
          name: 'Message',
          value:
            options.getString('details') !== null
              ? options.getString('details')
              : 'No details provided.',
        },
        {
          name: 'Jump to report',
          value: r.url,
        },
      ],
      timestamp: new Date(),
      footer: {
        icon_url: client.user.avatarURL(),
        text: 'Created',
      },
    });

    const resolve = new MessageActionRow().addComponents(
      new MessageSelectMenu()
        .setCustomId('report::0')
        .setMaxValues(1)
        .setPlaceholder('Select disposition')
        .addOptions(dispositionEntries)
    );

    let s;
    // Send staff embed
    try {
      s = await (<Discord.TextChannel>(
        guild.channels.cache.get(process.env.REPORTS_CHANNEL_ID)
      )).send({
        embeds: [staff],
        components: [resolve],
      });
    } catch (error) {
      await interaction.reply({
        content: 'Could not record report.',
        ephemeral: true,
      });

      await logger.error(error, '/report: Could not record report');
    }

    // Add URL for staff to jump to staff channel
    report.fields[1].value = `[Case](${s.url})`;

    try {
      await r.edit({
        embeds: [report],
      });
    } catch (error) {
      await logger.error(
        error,
        'Could not modify public report embed to include case url'
      );
    }

    try {
      await interaction.reply({
        content:
          'Thank you for helping keep Homework Help safe. Please contact us via <@575252669443211264> if the incident does not get resolved in a timely manner.',
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content: 'Error sending report confirmation message.',
        ephemeral: true,
      });

      await logger.error(error, 'Could not send report confirmation message');
    }
  }

  async executeButton(interaction: Discord.ButtonInteraction, id: Number) {
    if (id === actions.CANCEL_REPORT) {
      const { guild, message, user } = interaction;

      await interaction.deferReply();

      // Report URL - get channel and message id from url
      const [, , , , , c, m] = message.embeds[0].fields[4].value.split('/');

      // Report message log
      const reportLogEmbed = message.embeds[0];

      // Copy embed and edit to reflect resolved
      let reportMessage;

      // Fetch report embed (created by reporter)
      try {
        const reportChannel = await (<Discord.TextChannel>(
          guild.channels.cache.get(c)
        ));
        reportMessage = await reportChannel.messages.fetch(m);
      } catch (error) {
        await interaction.editReply({
          content: 'Could not fetch original report embed.',
        });

        await logger.error(error, 'Could not fetch original report embed');
      }
      const reportEmbed = reportMessage.embeds[0];

      // Get resolver's username and discriminator
      const [username, discriminator] = (<Discord.MessageButton>(
        message.components[0].components[0]
      )).label.split('#');

      // Check if resolver's name is the same as the one on the buttons
      if (username === user.username && discriminator === user.discriminator) {
        // Delete message in reports archive and send back to regular reports channel
        // Reset buttons to unresolved state
        const resolve = new MessageActionRow().addComponents(
          new MessageSelectMenu()
            .setCustomId('report::0')
            .setMaxValues(1)
            .setPlaceholder('Select resolve disposition')
            .addOptions(dispositionEntries)
        );

        reportLogEmbed.color = 16645888;

        let report;

        try {
          report = await (<Discord.TextChannel>(
            guild.channels.cache.get(process.env.REPORTS_CHANNEL_ID)
          )).send({
            embeds: [reportLogEmbed],
            components: [resolve],
          });
        } catch (error) {
          await interaction.editReply({
            content:
              'Could not send cancelled report back to unsolved report channel',
          });

          await logger.error(
            error,
            'Could not send cancelled report back to unsolved report channel'
          );
        }

        // Modify report embed in channel where report was generated
        reportEmbed.color = 16645888;
        (reportEmbed.fields[0].value =
          'Thank you for the report. We will review it shortly.'),
          (reportEmbed.fields[1].value = `[Case](${report.url})`);

        try {
          await reportMessage.edit({
            embeds: [reportEmbed],
          });

          await (<Discord.Message>message).delete();
        } catch (error) {
          await interaction.editReply({
            content:
              'Could not edit original report embed or delete the solved report',
          });

          await logger.error(
            error,
            'Could not edit original report embed or delete the solved report'
          );
        }

        await interaction.editReply({
          content: `Reverted report resolve. See ${report.url}`,
        });
      } else {
        await interaction.editReply({
          content: 'You cannot cancel since you are not the resolver!',
        });
      }
    }
  }

  async executeMenu(interaction: Discord.SelectMenuInteraction, id: Number) {
    if (id === actions.RESOLVE_REPORT) {
      const { guild, message, user, values } = interaction;
      const [disposition] = values; // get first value since only one can be selected from dropdown

      await interaction.deferReply();

      // Report URL - get channel and message id from url
      const [, , , , , c, m] = message.embeds[0].fields[4].value.split('/');

      // Report message log
      const reportLogEmbed = message.embeds[0];

      let reportMessage;

      try {
        // Copy embed and edit to reflect resolved
        const reportChannel = await (<Discord.TextChannel>(
          guild.channels.cache.get(c)
        ));
        reportMessage = await reportChannel.messages.fetch(m);
      } catch (error) {
        await interaction.editReply({
          content: 'Could not retrieve original report embed',
        });

        await logger.error(error, 'Could not retrieve original report embed');
      }
      const reportEmbed = reportMessage.embeds[0];

      // Delete report and move into archive channel once resolved
      // Set resolve button to green, set who resolved it. Also add cancel button if there was an error
      const button = new MessageActionRow().addComponents(
        new MessageButton()
          .setCustomId('report::0')
          .setLabel(`${user.username}#${user.discriminator}`)
          .setStyle('SUCCESS')
          .setDisabled(),
        new MessageButton()
          .setCustomId('report::1')
          .setLabel('Cancel')
          .setStyle('SECONDARY')
      );

      switch (disposition) {
        case dispositions.NO_ACTION:
          reportLogEmbed.color = 9807270;
          break;
        case dispositions.NOTE:
          reportLogEmbed.color = 16776960;
          break;
        case dispositions.VERBAL_WARN:
          reportLogEmbed.color = 15844367;
          break;
        case dispositions.FORMAL_WARN:
          reportLogEmbed.color = 15105570;
          break;
        case dispositions.MUTE:
          reportLogEmbed.color = 10181046;
          break;
        case dispositions.KICK:
          reportLogEmbed.color = 15158332;
          break;
        case dispositions.SOFTBAN:
          reportLogEmbed.color = 12370112;
          break;
        case dispositions.BAN:
          reportLogEmbed.color = 10038562;
          break;
      }

      let archived;
      try {
        archived = await (<Discord.TextChannel>(
          guild.channels.cache.get(process.env.REPORTS_ARCHIVE_CHANNEL_ID)
        )).send({
          content: `**Disposition**: ${disposition}`,
          embeds: [reportLogEmbed],
          components: [button],
        });
      } catch (error) {
        await interaction.editReply({
          content: 'Could not archive report',
        });

        await logger.error(error, 'Could not archive report');
      }

      // Modify report embed in channel where report was generated
      reportEmbed.color = 1441536;
      (reportEmbed.fields[0].value =
        'A staff member has reviewed your report. If you think there was a mistake, please contact us via <@575252669443211264>.'),
        (reportEmbed.fields[1].value = `[Case](${archived.url})`);

      try {
        await reportMessage.edit({
          embeds: [reportEmbed],
        });

        await (<Discord.Message>message).delete();
      } catch (error) {
        await interaction.editReply({
          content:
            'Could not edit original report embed or delete the unresolved report',
        });

        await logger.error(
          error,
          'Could not edit original report embed or delete the unresolved report'
        );
      }

      await interaction.editReply({
        content: `Report resolved. See ${archived.url}`,
      });
    }

    setTimeout(async () => {
      await interaction.deleteReply();
    }, 5000);
  }
}
